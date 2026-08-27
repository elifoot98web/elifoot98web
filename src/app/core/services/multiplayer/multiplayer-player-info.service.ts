import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { MultiplayerUserRole, PlayerConnectionQuality, PlayerIdentMessage, PlayerInfo } from '../../models/multiplayer';
import { Room, selfId } from 'trystero';
import { MULTIPLAYER } from '../../models/constants';

@Injectable({
  providedIn: 'root'
})
export class MultiplayerPlayerInfoService {

  private remotePlayers: { [peerId: string]: PlayerInfo } = {}; // Maps peerId to player name
  private playerListSubject = new BehaviorSubject<PlayerInfo[]>([]);
  private pingInterval?: ReturnType<typeof setInterval>; // For latency updates
  /**
   * Who the stream says is hosting. Kept here so the ident handler can stamp the role of a
   * peer whose stream already arrived; fed by `setHostPeer` from `MultiplayerService`.
   */
  private hostPeerId: string | null = null;
  /**
   * Everyone we have EVER seen in this room, never pruned on leave.
   *
   * Distinct from `remotePlayers` on purpose: the roster and the headcount must reflect who is
   * present, but the transcript has to keep attributing old messages after their author
   * leaves. Resolving names only from the live roster made a departing peer's history collapse
   * to a raw peer id. Cleared with the room, so it never leaks across rooms.
   */
  private knownPlayers: { [peerId: string]: PlayerInfo } = {};
  private knownPlayersSubject = new BehaviorSubject<PlayerInfo[]>([]);

  /** For anything rendering history rather than presence. */
  knownPlayers$ = this.knownPlayersSubject.asObservable();

  /** Last time we complained about each peer, so a flapping link cannot spam the host. */
  private lastWarnedAt: { [peerId: string]: number } = {};

  /**
   * Emits when a peer's link degrades into `poor` or `lost` from something better. Edge
   * triggered, so a peer that simply stays bad is reported once, not every ten seconds.
   */
  private connectionWarningSubject = new Subject<PlayerInfo>();
  connectionWarning$ = this.connectionWarningSubject.asObservable();

  /**
   * Emits once per peer, the first time we learn who they are. Distinct from
   * `playerList$`, which also fires on every latency update — a join line must not be
   * written every 10 seconds.
   */
  private playerJoinedSubject = new Subject<PlayerInfo>();
  playerJoined$ = this.playerJoinedSubject.asObservable();

  constructor() { }

  playerList$ = this.playerListSubject.asObservable();

  setup(room: Room) {
    // Guard against a second setup silently orphaning the previous interval
    this.clear();

    // Listen for player ident messages
    const playerIdent = room.makeAction<PlayerIdentMessage>(MULTIPLAYER.EVENTS.PLAYER_IDENT);
    playerIdent.onMessage = (ident, { peerId }) => {
      console.log(`Received ident message from ${peerId}`, { ident });
      const isNew = this.remotePlayers[peerId] === undefined;
      const playerInfo: PlayerInfo = {
        peerId,
        playerName: ident.name,
        playerColor: ident.color,
        // Deliberately NOT `ident.host`: a role is a fact about who delivered a video
        // track, not a claim a peer makes about itself. `setHostPeer` owns this field for
        // every remote peer; a peer whose stream has not arrived yet is a guest until it
        // does.
        role: peerId === this.hostPeerId ? MultiplayerUserRole.HOST : MultiplayerUserRole.GUEST,
        latency: -1, // Initial latency, will be updated later
        quality: 'unknown'
      }
      this.updatePlayer(playerInfo);
      // Measure straight away rather than waiting up to PING_REFRESH_INTERVAL: an ident is
      // the first moment this peer exists for us, and a roster stuck on "medindo…" for ten
      // seconds reads as broken.
      this.pingPeer(room, peerId);
      // Only the first ident from a peer is a join. A peer may re-send its ident.
      if (isNew) this.playerJoinedSubject.next(playerInfo);
    };

    this.pingInterval = setInterval(() => {
      Object.keys(this.remotePlayers)
        .filter(peerId => peerId !== selfId)
        .forEach(peerId => this.pingPeer(room, peerId));
    }, MULTIPLAYER.PING_REFRESH_INTERVAL);
  }

  /**
   * Measure one peer and fold the result into its `latency` and `quality`.
   *
   * The timeout is raced rather than flagged so that both outcomes run through the same
   * settle path: `Promise.race` subscribes to the ping, so a late rejection is consumed
   * instead of surfacing as an unhandled rejection, and `finally` disposes the timer on
   * every branch — the previous version leaked one per slow or failed ping.
   */
  private pingPeer(room: Room, peerId: string) {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(`Ping to ${peerId} timed out`)), MULTIPLAYER.PING_TIMEOUT);
    });

    return Promise.race([room.ping(peerId), expiry])
      .then(latency => this.recordReachable(room, peerId, latency))
      .catch(() => this.recordUnreachable(room, peerId))
      .finally(() => clearTimeout(timeoutHandle));
  }

  private recordReachable(room: Room, peerId: string, latency: number) {
    const player = this.getPlayer(peerId);
    if (!player) return; // Left while we were measuring

    let quality: PlayerConnectionQuality = latency < MULTIPLAYER.PING_GOOD_MAX
      ? 'good'
      : latency < MULTIPLAYER.PING_FAIR_MAX ? 'fair' : 'poor';
    // An answer from a peer whose connection has already failed is stale news.
    if (!this.isPeerConnected(room, peerId)) quality = 'lost';

    this.applyConnection(player, latency, quality);
  }

  private recordUnreachable(room: Room, peerId: string) {
    const player = this.getPlayer(peerId);
    if (!player) return;

    // The distinction the roster needs: a live connection that failed to answer is a bad
    // link, while a missing or failed one means the peer is gone. Keep the last measured
    // latency rather than inventing one — the quality field carries the bad news.
    this.applyConnection(player, player.latency, this.isPeerConnected(room, peerId) ? 'poor' : 'lost');
  }

  /** Connection truth, straight from the peer connections trystero is holding. */
  private isPeerConnected(room: Room, peerId: string): boolean {
    const state = room.getPeers()[peerId]?.connectionState;
    return state === 'connected' || state === 'connecting' || state === 'new';
  }

  private applyConnection(player: PlayerInfo, latency: number, quality: PlayerConnectionQuality) {
    const previous = player.quality;
    // A fresh object, not a mutation of the one already in the map: `updatePlayer` re-emits
    // `Object.values()`, so mutating in place hands subscribers a new array of unchanged
    // references and anything comparing references sees nothing.
    this.updatePlayer({ ...player, latency, quality });

    const isBad = quality === 'poor' || quality === 'lost';
    const wasBad = previous === 'poor' || previous === 'lost';
    if (isBad && !wasBad) this.warnAboutConnection(player);
  }

  /** Edge-triggered on the way down only, and rate-limited per peer. */
  private warnAboutConnection(player: PlayerInfo) {
    const now = performance.now();
    const lastWarned = this.lastWarnedAt[player.peerId];
    if (lastWarned !== undefined && now - lastWarned < MULTIPLAYER.CONNECTION_WARNING_COOLDOWN) return;

    this.lastWarnedAt[player.peerId] = now;
    this.connectionWarningSubject.next(player);
  }

  clear() {
    clearInterval(this.pingInterval); // Stop ping updates
    this.pingInterval = undefined;
    this.remotePlayers = {};
    this.knownPlayers = {};
    this.hostPeerId = null;
    this.lastWarnedAt = {};
    this.playerListSubject.next([]);
    this.knownPlayersSubject.next([]);
  }

  /**
   * Stamp the HOST role onto the peer the video stream came from, and clear it from
   * everyone else. Pass null when host identity is unclaimed.
   *
   * Self is skipped: the local role is known locally and authoritative, which also means a
   * host does not need this at all (it receives no stream, so `hostPeerId$` stays null).
   */
  setHostPeer(hostPeerId: string | null) {
    this.hostPeerId = hostPeerId;

    let changed = false;
    for (const [peerId, player] of Object.entries(this.remotePlayers)) {
      if (peerId === selfId) continue;
      const role = peerId === hostPeerId ? MultiplayerUserRole.HOST : MultiplayerUserRole.GUEST;
      if (player.role !== role) {
        this.remotePlayers[peerId] = { ...player, role };
        changed = true;
      }
    }
    if (changed) this.playerListSubject.next(Object.values(this.remotePlayers));
  }

  /**
   * Register the local player so the roster can list everyone in the room, not just peers.
   * Latency is meaningless for ourselves, so it stays at 0 — and the view renders "você"
   * rather than a number or a quality for the local row.
   */
  setLocalPlayer(playerName: string, playerColor: string, role: MultiplayerUserRole) {
    this.updatePlayer({ peerId: selfId, playerName, playerColor, role, latency: 0, quality: 'good' });
  }

  updatePlayer(playerInfo: PlayerInfo) {
    this.remotePlayers[playerInfo.peerId] = playerInfo;
    // Mirrored into the sticky map so the transcript can still name this peer after it leaves.
    this.knownPlayers[playerInfo.peerId] = playerInfo;
    this.playerListSubject.next(Object.values(this.remotePlayers));
    this.knownPlayersSubject.next(Object.values(this.knownPlayers));
  }

  removePlayer(peerId: string) {
    delete this.remotePlayers[peerId];
    delete this.lastWarnedAt[peerId];
    this.playerListSubject.next(Object.values(this.remotePlayers));
  }

  getPlayer(peerId: string): PlayerInfo | undefined {
    return this.remotePlayers[peerId];
  }
}
