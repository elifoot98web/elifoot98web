import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { MultiplayerUserRole, PlayerIdentMessage, PlayerInfo } from '../../models/multiplayer';
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
        role: ident.host ? MultiplayerUserRole.HOST : MultiplayerUserRole.GUEST,
        latency: -1 // Initial latency, will be updated later
      }
      this.updatePlayer(playerInfo);
      // Only the first ident from a peer is a join. A peer may re-send its ident.
      if (isNew) this.playerJoinedSubject.next(playerInfo);
    };

    this.pingInterval = setInterval(() => {
      const peerIds = Object.keys(this.remotePlayers).filter(peerId => peerId !== selfId);
      peerIds.forEach(peerId => {
        let timedOut = false;

        const timeOutHandler = setTimeout(() => {
          timedOut = true; // Mark as timed out
        }, MULTIPLAYER.PING_TIMEOUT)

        room.ping(peerId).then(latency => {
          if(timedOut) return; // Ignore if already timed out

          clearTimeout(timeOutHandler); // Clear timeout if we got a response

          const playerInfo = this.getPlayer(peerId);
          if (!playerInfo) return;

          playerInfo.latency = latency;
          this.updatePlayer(playerInfo); // Update player with new latency
        })
      })
    }, MULTIPLAYER.PING_REFRESH_INTERVAL);
  }

  clear() {
    clearInterval(this.pingInterval); // Stop ping updates
    this.pingInterval = undefined;
    this.remotePlayers = {};
    this.playerListSubject.next([]);
  }

  /**
   * Register the local player so the roster can list everyone in the room, not just peers.
   * Latency is meaningless for ourselves, so it stays at 0.
   */
  setLocalPlayer(playerName: string, playerColor: string, role: MultiplayerUserRole) {
    this.updatePlayer({ peerId: selfId, playerName, playerColor, role, latency: 0 });
  }

  updatePlayer(playerInfo: PlayerInfo) {
    this.remotePlayers[playerInfo.peerId] = playerInfo;
    this.playerListSubject.next(Object.values(this.remotePlayers));
  }

  removePlayer(peerId: string) {
    delete this.remotePlayers[peerId];
    this.playerListSubject.next(Object.values(this.remotePlayers));
  }

  getPlayer(peerId: string): PlayerInfo | undefined {
    return this.remotePlayers[peerId];
  }
}
