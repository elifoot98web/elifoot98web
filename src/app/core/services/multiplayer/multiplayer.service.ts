import { Injectable } from '@angular/core';
import { HandshakeReceiver, HandshakeSender, JoinError, joinRoom, JoinRoomConfig, RequestAction, Room, selfId } from 'trystero';
import {
  AdmissionPayload,
  GameState,
  HostAnnounceMessage,
  MultiplayerJoinErrorKind,
  MultiplayerUserRole,
  PlayerIdentMessage,
  PlayerInfo,
  RoleDescriptor,
  RoleQueryRequest
} from '../../models/multiplayer';
import { MULTIPLAYER } from '../../models/constants';
import { MultiplayerChatService } from './multiplayer-chat.service';
import { MultiplayerCursorService } from './multiplayer-cursor.service';
import { MultiplayerPlayerInfoService } from './multiplayer-player-info.service';
import { BehaviorSubject, filter, Subject, Subscription } from 'rxjs';
import { MultiplayerStreamService } from './multiplayer-stream.service';
import { MultiplayerAudioService } from './multiplayer-audio.service';
import { MultiplayerAdmissionService } from './multiplayer-admission.service';
import { MultiplayerRelayHealthService } from './multiplayer-relay-health.service';
import { WireGuardHelper } from '../../helpers/wire-guard.helper';
import { environment } from 'src/environments/environment';

@Injectable({
  providedIn: 'root'
})
export class MultiplayerService {
  // This service centralizes the core multiplayer logic, rooms, users which can be used by both host and guest.

  // Game state management
  private playerName: string = '';
  private roomName: string = '';
  private password: string = '';
  private playerColor: string = MULTIPLAYER.DEFAULT_CURSOR_COLOR;

  private playerRole: MultiplayerUserRole = MultiplayerUserRole.GUEST; // Default role is GUEST

  // Trystero room logic and callbacks
  private room?: Room;
  private roleQuery?: RequestAction<RoleQueryRequest, RoleDescriptor>;
  private onPeerJoinHandlers: ((peerId: string) => void)[] = [];
  private onPeerLeaveHandlers: ((peerId: string) => void)[] = [];

  // Room lifecycle serialisation. See leaveRoom() for why these exist.
  private leavingPromise?: Promise<void>;
  private joiningPromise?: Promise<void>;
  private isLeaving = false;

  /** performance.now() when this device started broadcasting; undefined when not hosting. */
  private hostingSince?: number;

  /** Pending "wait for the host to come back" timer; see startHostGrace(). */
  private hostGraceTimer?: ReturnType<typeof setTimeout>;

  /** Pending "believe the refusal?" timer on a guest; see onRoomFullClaim(). */
  private roomFullTimer?: ReturnType<typeof setTimeout>;

  /** The error a refusing host throws from the admission gate; see classifyJoinError(). */
  private static readonly ROOM_FULL_ERROR = 'room-full';

  /** Join lines still serving out their delay, by peer; see scheduleJoinLine(). */
  private pendingJoinLines = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Bumped on every room entry and exit, so anything deferred can tell whether the room it
   * was armed for is still the current one. `leaveRoom` is synchronous and a rejoin can
   * begin while the previous room is still draining, which a bare clear cannot cover.
   */
  private roomEpoch = 0;

  /** Feeds join lines into the transcript; torn down with the room. */
  private playerInfoSubscription?: Subscription;


  // Subjects
  gameStateSubject = new BehaviorSubject<GameState>(GameState.NOT_IN_ROOM);

  /** Emits the room code when another host is found on it and we are the one yielding. */
  private hostCollisionSubject = new Subject<string>();
  hostCollision$ = this.hostCollisionSubject.asObservable();

  /** Emits when another host tried our code and lost. Informational; we keep the room. */
  private codeContestedSubject = new Subject<void>();
  codeContested$ = this.codeContestedSubject.asObservable();

  /** Emits when a stranger fails to join our room. Informational; never fatal to a host. */
  private intrusionSubject = new Subject<MultiplayerJoinErrorKind>();
  intrusion$ = this.intrusionSubject.asObservable();

  /** Emits failures trystero could actually name, so a guest need not wait out the timeout. */
  private joinErrorSubject = new Subject<MultiplayerJoinErrorKind>();
  joinError$ = this.joinErrorSubject.asObservable();

  constructor(
    private multiplayerCursorService: MultiplayerCursorService,
    private playerInfoService: MultiplayerPlayerInfoService,
    private chatService: MultiplayerChatService,
    private streamService: MultiplayerStreamService,
    private audioService: MultiplayerAudioService,
    private admissionService: MultiplayerAdmissionService,
    private relayHealthService: MultiplayerRelayHealthService
  ) { }

  get isInRoom(): boolean {
    return this.room !== undefined;
  }

  /**
   * True while this browser holds a room it is broadcasting, from the moment the room is
   * entered as host until it is left. A reload ends such a room for every spectator in it.
   * A spectator has nothing comparable to lose: its page keeps no emulator and no save
   * state, which is why JoinGamePage.reloadSpectator may reload it freely.
   */
  get isHosting(): boolean {
    return this.room !== undefined && this.playerRole === MultiplayerUserRole.HOST;
  }

  /** True while a previous room is still tearing down. Callers may show a hint. */
  get isDraining(): boolean {
    return this.leavingPromise !== undefined;
  }

  async hostGameRoom(
    hostName: string,
    roomName: string,
    password: string,
    stream: MediaStream,
    color?: string,
    maxSpectators?: number
  ) {
    // Before the room exists, so no peer can be judged against a stale limit.
    this.admissionService.setLimit(maxSpectators);
    await this.joinRoom(hostName, roomName, password, MultiplayerUserRole.HOST, color);
    this.setupHost(stream);
  }

  async joinGameRoom(playerName: string, roomName: string, password: string, color?: string): Promise<void> {
    await this.joinRoom(playerName, roomName, password, MultiplayerUserRole.GUEST, color);
    this.setupGuest()
  }

  /**
   * Tear down the room and reset all multiplayer state.
   *
   * Stays synchronous on purpose: both page `ngOnDestroy` hooks call it and cannot
   * await, and making it async would quietly turn those into fire-and-forget calls
   * with an unhandled-rejection surface. The teardown is instead captured in
   * `leavingPromise`, which `joinRoom()` drains before touching trystero again.
   *
   * @param nextState the state to settle on. Callers that are leaving *because* of a
   *   condition worth reporting (the host vanished, say) pass that state so it is not
   *   overwritten by the default idle state.
   */
  leaveRoom(nextState: GameState = GameState.NOT_IN_ROOM) {
    this.isLeaving = true;
    try {
      this.roomEpoch += 1; // Invalidates anything deferred by the room we are leaving
      this.clearHostGrace();
      this.clearRoomFullTimer();
      this.clearPendingJoinLines();

      // Captured BEFORE clearing this.room. room.leave() is async and trystero only
      // drops the room from its registry once it settles (a send plus a ~99ms wait);
      // until then joinRoom() for the same appId+roomId hands back this same dying
      // object, which is how retrying the same code used to yield a dead room.
      this.leavingPromise = (this.room?.leave() ?? Promise.resolve())
        .catch(err => console.warn('Error while leaving the multiplayer room', err));
      this.room = undefined;
      this.roleQuery = undefined;
      this.hostingSince = undefined;

      this.playerInfoSubscription?.unsubscribe();
      this.playerInfoSubscription = undefined;

      this.playerRole = MultiplayerUserRole.GUEST; // Reset role
      this.playerName = '';
      this.roomName = '';
      this.password = '';
      this.playerColor = MULTIPLAYER.DEFAULT_CURSOR_COLOR;

      this.onPeerJoinHandlers = []; // Clear join handlers
      this.onPeerLeaveHandlers = []; // Clear leave handlers

      // Clear services
      this.playerInfoService.clear();
      this.multiplayerCursorService.clear();
      this.chatService.clear();
      this.streamService.clear(); // Clear stream service state
      this.audioService.clear(); // Release the tap on the game's audio
      this.admissionService.clear(); // Forget held slots and put the limit back to its default

      this.setState(nextState);
      console.log('Left the multiplayer room and reset service state.');
    } finally {
      this.isLeaving = false;
    }
  }

  /**
   * Publish a new game state to subscribers. All state transitions go through here so
   * that the subject and the current state can never drift apart.
   */
  setState(state: GameState) {
    // A room that is live again is a room that is no longer waiting. Done here rather than
    // at the call site so every route back to IN_ROOM disarms the timer, including the
    // reattach the guest page drives.
    if (state === GameState.IN_ROOM) this.clearHostGrace();

    if (this.gameStateSubject.value !== state) {
      this.gameStateSubject.next(state);
    }
  }

  /**
   * Hold the room open for a host that dropped, instead of ending it on the first blip.
   *
   * The timer is keyed on the room generation because `leaveRoom` is synchronous and
   * returns while trystero is still draining: a guest can be in a *new* room well before a
   * timer armed in the old one fires, and clearing alone cannot cover the case where the
   * rejoin happens between the two.
   */
  private startHostGrace() {
    this.clearHostGrace();
    this.setState(GameState.HOST_RECONNECTING);

    const epoch = this.roomEpoch;
    this.hostGraceTimer = setTimeout(() => {
      this.hostGraceTimer = undefined;
      if (epoch !== this.roomEpoch) {
        console.log('Host grace period expired for a room we have already left; ignoring.');
        return;
      }
      console.warn('Host did not come back within the grace period. Ending the room.');
      this.setState(GameState.HOST_LEFT);
    }, MULTIPLAYER.HOST_GRACE_TIMEOUT);
  }

  private clearHostGrace() {
    clearTimeout(this.hostGraceTimer);
    this.hostGraceTimer = undefined;
  }

  private clearRoomFullTimer() {
    clearTimeout(this.roomFullTimer);
    this.roomFullTimer = undefined;
  }

  /**
   * Write "Fulano entrou na sala." only once the arrival has lasted, so a peer that turns up
   * and leaves again at once produces no transcript lines at all.
   *
   * The case this exists for is a second host trying a code that is already in use: it joins,
   * discovers the collision and yields within a few hundred milliseconds, which used to leave
   * every spectator in the established room reading a join and a leave for someone who was
   * never in their room. Deferring rather than reading the peer's own claimed role is
   * deliberate — that would be trusting exactly the self-declaration host identity does not.
   *
   * Keyed on the room generation for the same reason as the host grace timer: `leaveRoom` is
   * synchronous and a rejoin can begin before a timer armed in the previous room fires.
   */
  private scheduleJoinLine(player: PlayerInfo) {
    const peerId = player.peerId;
    const observedAt = Date.now();
    const epoch = this.roomEpoch;

    clearTimeout(this.pendingJoinLines.get(peerId));
    this.pendingJoinLines.set(peerId, setTimeout(() => {
      this.pendingJoinLines.delete(peerId);
      if (epoch !== this.roomEpoch) return;
      // Re-read: an ident carrying the name may have landed after the join event did.
      const current = this.playerInfoService.getPlayer(peerId) ?? player;
      this.chatService.addSystemMessage(`${this.describePlayer(current)} entrou na sala.`, observedAt);
    }, MULTIPLAYER.SYSTEM_JOIN_LINE_DELAY));
  }

  /**
   * Drop a join line that never made it to the transcript.
   *
   * @returns true when there was one, meaning the departure must not be announced either.
   */
  private cancelJoinLine(peerId: string): boolean {
    const timer = this.pendingJoinLines.get(peerId);
    if (timer === undefined) return false;

    clearTimeout(timer);
    this.pendingJoinLines.delete(peerId);
    return true;
  }

  private clearPendingJoinLines() {
    this.pendingJoinLines.forEach(timer => clearTimeout(timer));
    this.pendingJoinLines.clear();
  }

  /**
   * Serialised entry point. Waits for any in-flight teardown *and* any in-flight join
   * before entering a room: `isInRoom` is false while a room is draining, so without
   * the join half of the mutex two rapid calls could both get through.
   */
  private joinRoom(
    playerName: string,
    roomName: string,
    password: string,
    role: MultiplayerUserRole,
    color?: string
  ): Promise<void> {
    // Drained in order, rejections swallowed: this gate only establishes ordering.
    const drain = (pending?: Promise<void>) => Promise.resolve(pending).catch(() => undefined);
    const gate = drain(this.joiningPromise).then(() => drain(this.leavingPromise));

    const joined = gate.then(() => {
      this.leavingPromise = undefined;
      this.enterRoom(playerName, roomName, password, role, color);
    });
    // The stored handle exists only to order the *next* call, so its rejection is
    // swallowed here; the caller still sees it through the returned promise.
    this.joiningPromise = joined.catch(() => undefined);
    return joined;
  }

  private enterRoom(playerName: string, roomName: string, password: string, role: MultiplayerUserRole, color?: string): void {
    if (this.room) throw new Error('Already in a room. Please leave the current room before joining a new one.');

    this.roomEpoch += 1; // A new generation, so a stale grace timer cannot fire into it
    this.setState(GameState.JOINING_ROOM);

    this.playerName = playerName;
    this.roomName = roomName;
    this.password = password;
    this.playerRole = role;
    this.playerColor = color || MULTIPLAYER.DEFAULT_CURSOR_COLOR;

    const turnConfig = environment.multiplayerConfig.turnConfig;
    const config: JoinRoomConfig = {
      appId: MULTIPLAYER.APP_ID,
      password: this.password,
      turnConfig,
      // Lets the relay-health service see every connection trystero makes, including the ones
      // that never come up. Do NOT add `rtcConfig.iceServers` next to this: it would replace
      // trystero's default STUN list, which is what keeps most pairs connecting when the relay
      // is down.
      ...(turnConfig.length > 0 ? { rtcPolyfill: this.relayHealthService.peerConnectionClass(true) } : {})
    }
    const room = joinRoom(config, this.roomName.toUpperCase(), {
      onJoinError: details => this.handleJoinError(details),
      onPeerHandshake: (peerId, send, receive) => this.onPeerHandshake(peerId, send, receive),
    });
    this.room = room;

    this.initPeerListeners(); // Initialize peer listeners for join/leave events

    // Registered on both roles: a host asks joining peers what they are in order to
    // notice a collision, and a guest can be asked in turn.
    this.roleQuery = room.makeAction<RoleQueryRequest, RoleDescriptor>(
      MULTIPLAYER.EVENTS.ROLE_QUERY,
      { kind: 'request', onRequest: () => this.describeSelf() }
    );

    // The host is whoever delivered the video track, not whoever claims to be — see the
    // multiplayer UX study, decisions (c) and (e). `releaseHost` runs after the check so a
    // returning host can claim identity again; the host-only `handlePeerLeave` in the
    // stream service never fires on a guest, so this is where it has to happen.
    if (role === MultiplayerUserRole.GUEST) {
      this.addOnPeerLeaveHandler((peerId: string) => {
        if (this.streamService.hostPeerId === peerId) {
          console.warn(`Host ${peerId} left the room. Holding the last frame.`);
          this.streamService.releaseHost(peerId);
          this.startHostGrace();
        }
      });
    }

    // Setup shared services. Chat first: the player-info service emits the join line
    // from its ident handler, so the transcript has to exist before it can be written to.
    this.setupChatService();
    this.setupCursorService();
    this.setupPlayerInfoService();
  }

  private initPeerListeners() {
    if (!this.room) throw new Error('Room is not initialized');

    this.room.onPeerJoin = (peerId) => {
      this.onPeerJoin(peerId);
    }

    this.room.onPeerLeave = (peerId) => {
      this.onPeerLeave(peerId);
    }
  }

  /** Falls back to a short peer id so a nameless peer still reads sensibly. */
  private describePlayer(player: PlayerInfo): string {
    return player.playerName?.trim() || player.peerId.slice(0, 6);
  }

  /** Answer to a roleQuery. Must always return a payload; trystero rejects undefined. */
  private describeSelf(): RoleDescriptor {
    return {
      role: this.playerRole === MultiplayerUserRole.HOST ? 'host' : 'guest',
      name: this.playerName || '',
      color: this.playerColor,
      hostingForMs: this.hostingForMs(),
    };
  }

  private setupGuest() {
    if (!this.room) return;

    // Registered so the payload is consumed rather than buffered, and so the guest
    // learns who the host is without waiting for anything else.
    const hostAnnounce = this.room.makeAction<HostAnnounceMessage>(MULTIPLAYER.EVENTS.HOST_ANNOUNCE);
    hostAnnounce.onMessage = (data, { peerId }) => {
      console.log(`Host announced itself: ${data.hostName} (${peerId})`);
    };

    this.setState(GameState.WAITING_STREAM);
    this.setupStreamService();
  }

  private setupHost(stream: MediaStream) {
    if (!this.room) return;
    const room = this.room;

    // Recorded before anything else so the collision tie-break can compare ages.
    this.hostingSince = performance.now();

    const hostAnnounce = room.makeAction<HostAnnounceMessage>(MULTIPLAYER.EVENTS.HOST_ANNOUNCE);
    // Another host announcing itself is a collision, detected without a round trip.
    hostAnnounce.onMessage = (data, { peerId }) => {
      console.warn(`Another host is on this room code: ${data.hostName} (${peerId})`);
      this.resolveHostCollision(peerId, data.hostingForMs);
    };

    this.addOnPeerJoinHandler((peerId: string) => {
      hostAnnounce.send(
        { hostName: this.playerName || 'Anfitrião', hostingForMs: this.hostingForMs() },
        { target: peerId }
      );
      this.detectHostCollision(peerId);
    });

    this.setupStreamService(stream);
    this.setState(GameState.IN_ROOM);
  }

  /**
   * Ask a freshly joined peer what it is. Replaces the old timed claim race: a
   * collision is observed whenever it becomes observable, with no window to miss.
   */
  private async detectHostCollision(peerId: string) {
    const roleQuery = this.roleQuery;
    if (!roleQuery) return;

    try {
      const peer = await roleQuery.request({}, {
        target: peerId,
        timeoutMs: MULTIPLAYER.ROLE_QUERY_TIMEOUT,
      });
      // Passed raw: `resolveHostCollision` sanitises the duration for both entry points,
      // so the guard lives in one place rather than at each caller.
      if (peer?.role === 'host') this.resolveHostCollision(peerId, peer.hostingForMs);
    } catch (err) {
      // Rejects with 'disconnected' if the peer vanished between joining and
      // answering, and on timeout. Neither is a collision we can act on.
      console.warn(`Could not read the role of peer ${peerId}`, err);
    }
  }

  /**
   * Two hosts on one room code. The one that has been broadcasting LONGER keeps it:
   * an established room may already have spectators watching a match, while a
   * just-started one has nobody, so yielding the older room is always the worse
   * outcome.
   *
   * No shared clock is involved — each side reports elapsed time from its own
   * monotonic clock, and only the two durations are compared. The two samples are
   * taken moments apart, so a difference under HOST_AGE_TOLERANCE is treated as
   * simultaneous and settled by comparing selfId, which both sides always agree on.
   *
   * Residual, stated honestly: if ICE between the two hosts never succeeds, neither
   * observes the other and both keep hosting. In that state they also cannot reach
   * each other's guests, so the rooms stay separate rather than scrambled.
   */
  private resolveHostCollision(peerId: string, theirHostingForMs: number) {
    if (this.isLeaving || this.playerRole !== MultiplayerUserRole.HOST) return;

    // `theirHostingForMs` is a self-reported duration, so a peer can claim any number it
    // likes and the tie-break below would hand it the room — the same forgeable-claim
    // problem that got `PlayerIdentMessage.host` deprecated. Unlike the role badge there
    // is no transport-level fact to substitute here: elapsed time genuinely only exists on
    // the sender's clock. So it is bounded instead. A claim above the ceiling is treated
    // as zero rather than clamped to the ceiling, because a value that large is not a
    // plausible session — it is a peer trying to win, and the right answer is to not
    // reward it.
    const theirs = WireGuardHelper.hostingDuration(theirHostingForMs);

    if (!this.shouldYieldRoom(peerId, theirs)) {
      console.warn(`Host collision with ${peerId}; keeping the room (ours is older).`);
      this.codeContestedSubject.next();
      return;
    }

    console.warn(`Host collision with ${peerId}; yielding the room code (theirs is older).`);
    const code = this.roomName;
    // Stop any further handler work immediately, then tear down off the current
    // stack: we may still be inside an onPeerJoin fan-out.
    this.isLeaving = true;
    queueMicrotask(() => {
      this.leaveRoom(GameState.ROOM_CODE_TAKEN);
      this.hostCollisionSubject.next(code);
    });
  }

  private shouldYieldRoom(peerId: string, theirHostingForMs: number): boolean {
    const mine = this.hostingForMs();
    const tolerance = MULTIPLAYER.HOST_AGE_TOLERANCE;

    if (mine + tolerance < theirHostingForMs) return true;  // they are clearly older
    if (theirHostingForMs + tolerance < mine) return false; // we are clearly older
    // Started within a couple of seconds of each other: no meaningful "first", so fall
    // back to a comparison both sides compute identically.
    return selfId > peerId;
  }

  /** Elapsed broadcast time on our own monotonic clock; 0 when not hosting. */
  private hostingForMs(): number {
    return this.hostingSince === undefined ? 0 : Math.round(performance.now() - this.hostingSince);
  }

  /**
   * trystero's admission gate, called once per peer after the password challenge and before
   * the peer is active. A peer held here is invisible to everything else — no `onPeerJoin`,
   * no actions, no stream, and trystero drops what it sends — which is what makes refusing
   * one clean, and why a stranger with the wrong password never gets as far as taking a slot.
   *
   * It runs for every pair in the room, so on a guest it is only ever a listener: a guest
   * does not know who the host is until video arrives, and refuses nobody.
   */
  private async onPeerHandshake(peerId: string, send: HandshakeSender, receive: HandshakeReceiver): Promise<void> {
    if (this.playerRole === MultiplayerUserRole.HOST) {
      const activePeerIds = Object.keys(this.room?.getPeers() ?? {});
      if (!this.admissionService.admit(peerId, activePeerIds)) {
        return this.refuseNewcomer(peerId, send, receive);
      }
    }

    // Admitted, or a guest: listen without blocking. Resolving at once is what lets the
    // handshake finish, so a peer that never says anything must not hold this up.
    this.listenForAdmissionPayload(peerId, send, receive);
  }

  /**
   * Turn a peer away, having first told it why.
   *
   * `send` is the only channel that reaches a peer that is still pending — an ordinary
   * action would just log "no peer with id" — so the reason has to go out before the throw.
   * Without it the refused guest could only wait out its stream timeout, and be told to go
   * and check the room code.
   *
   * The refused peer might be another host that picked this code. That would otherwise go
   * unnoticed, because the host-collision check runs off `onPeerJoin`, which a refused peer
   * never produces. So both sides exchange how long they have been hosting here, and each
   * runs the same tie-break the announce path uses: the younger yields. Only a host answers;
   * for a spectator this is just the second a refusal takes.
   */
  private async refuseNewcomer(peerId: string, send: HandshakeSender, receive: HandshakeReceiver): Promise<never> {
    console.warn(`Room is full (${this.admissionService.maxSpectators}); refusing ${peerId}.`);

    const refusal: AdmissionPayload = { __eli: 'room-full', hostingForMs: this.hostingForMs() };
    try {
      await send(refusal);
    } catch (err) {
      console.warn(`Could not tell ${peerId} the room is full`, err);
    }

    const answer = await this.waitForAdmissionPayload(receive, MULTIPLAYER.HOST_REPLY_WAIT_MS);
    if (answer) this.resolveHostCollision(peerId, answer.hostingForMs);

    throw new Error(MultiplayerService.ROOM_FULL_ERROR);
  }

  /**
   * One admission payload from a peer, or null if none arrives in time. Never rejects: the
   * handshake being torn down under us (`clearPeer` rejects its waiters) is not an error here.
   */
  private async waitForAdmissionPayload(receive: HandshakeReceiver, timeoutMs: number): Promise<AdmissionPayload | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        // The catch matters beyond tidiness: when the timer wins, this promise is still
        // pending and is rejected later by clearPeer, which would otherwise surface as an
        // unhandled rejection.
        receive().then(({ data }) => WireGuardHelper.admissionPayload(data)).catch(() => null),
        new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Wait, in the background, for the other side of a handshake to say something. Silence is
   * the normal case — an admitted peer sends nothing — and the waiter is rejected when the
   * peer goes away, which is why the rejection is swallowed.
   */
  private listenForAdmissionPayload(peerId: string, send: HandshakeSender, receive: HandshakeReceiver) {
    receive()
      .then(({ data }) => {
        const payload = WireGuardHelper.admissionPayload(data);
        if (payload) this.onAdmissionPayload(peerId, payload, send);
      })
      .catch(() => { /* the peer left before saying anything */ });
  }

  private onAdmissionPayload(peerId: string, payload: AdmissionPayload, send: HandshakeSender) {
    // A reply is only ever expected by the refusing side's own wait; arriving here it is noise.
    if (payload.__eli !== 'room-full') return;

    if (this.playerRole === MultiplayerUserRole.HOST) {
      // Only a host can refuse, so this is a rival on our room code that is full. Answer
      // first so it can tie-break too — it has no other way to learn our age — then do so
      // ourselves. If we are the one yielding the reply is wasted, which is harmless.
      send({ __eli: 'host-reply', hostingForMs: this.hostingForMs() } satisfies AdmissionPayload)
        .catch(err => console.warn(`Could not answer the host refusal from ${peerId}`, err));
      this.resolveHostCollision(peerId, payload.hostingForMs);
      return;
    }

    this.onRoomFullClaim(peerId);
  }

  /**
   * A guest is told the room is full. Believed only if no stream turns up.
   *
   * This arrives from a peer the guest cannot yet tell from an impostor: the host is
   * identified by the video it sends, and there is none yet. Trusting it outright would let
   * any spectator eject every newcomer by claiming the room is full. So it only starts a
   * short wait, and a stream arriving inside it wins — a forged refusal costs a guest who
   * was really admitted nothing, and one who really was refused learns in seconds instead of
   * waiting out the twenty-second stream timeout.
   */
  private onRoomFullClaim(peerId: string) {
    if (this.playerRole !== MultiplayerUserRole.GUEST || this.isLeaving) return;
    if (this.streamService.hostPeerId !== null) return;
    if (this.roomFullTimer !== undefined) return;

    console.warn(`${peerId} says the room is full; waiting for a stream before believing it.`);
    const epoch = this.roomEpoch;
    this.roomFullTimer = setTimeout(() => {
      this.roomFullTimer = undefined;
      if (epoch !== this.roomEpoch || this.streamService.hostPeerId !== null) return;
      this.joinErrorSubject.next('room-full');
    }, MULTIPLAYER.ROOM_FULL_GRACE_MS);
  }

  /**
   * trystero reports what it can: a password that fails to decrypt an offer, a
   * handshake that never completes, a relay that cannot be reached. Anything it
   * cannot name still falls through to the guest's stream-wait timeout.
   */
  private handleJoinError(details: JoinError) {
    console.warn('Multiplayer join error reported by trystero', details);
    const kind = this.classifyJoinError(details.error ?? '');
    if (!kind) return;

    if (kind === 'connection-failed') {
      console.warn(
        'If this persists for every peer, check environment.multiplayerConfig.turnConfig — ' +
        'a dead TURN relay looks exactly like a user network problem.'
      );
    }

    // A host must never tear down a healthy broadcast because a stranger guessed the
    // password wrong. Note trystero picks the offer leader by selfId, and only the
    // answering side fails to decrypt, so this fires on whichever side that happens
    // to be — which is precisely why the guest keeps its timeout as a fallback.
    if (this.playerRole === MultiplayerUserRole.HOST) {
      this.intrusionSubject.next(kind);
      return;
    }

    this.joinErrorSubject.next(kind);
  }

  private classifyJoinError(error: string): MultiplayerJoinErrorKind | undefined {
    // details.error is a plain English string, so substring matching is the only
    // option. Unrecognised text deliberately returns undefined rather than guessing.
    const text = error.toLowerCase();
    // First, because the substring tests below would otherwise claim it: trystero wraps what
    // a handshake throws as "handshake failed: …", which `includes('handshake')` reads as a
    // connection failure.
    if (text.includes(MultiplayerService.ROOM_FULL_ERROR)) return 'room-full';
    if (text.includes('decrypt') || text.includes('password')) return 'wrong-password';
    if (text.includes('handshake') || text.includes('ice') || text.includes('connect')) return 'connection-failed';
    return undefined;
  }

  private setupChatService() {
    if (!this.room) return;

    console.log('Setting up chat service for room:', this.roomName);
    this.chatService.setup(this.room); // Setup chat service with the room
  }

  private setupCursorService() {
    if (!this.room) return;
    this.multiplayerCursorService.setup(this.room); // Setup cursor service with the room

    this.addOnPeerLeaveHandler((peerId: string) => {
      this.multiplayerCursorService.removeCursor(peerId); // Remove cursor for this player
    });
  }

  private setupPlayerInfoService() {
    if (!this.room) return;
    const room = this.room; // Capture the room instance in this closure for use in handlers

    this.playerInfoService.setup(room); // Setup player info service
    this.playerInfoService.setLocalPlayer(this.playerName, this.playerColor, this.playerRole);

    // Join/leave lines. Generated locally on every peer rather than broadcast: everyone
    // observes these events for themselves, so sending them would duplicate them. The join
    // half is deferred — see scheduleJoinLine().
    this.playerInfoSubscription?.unsubscribe();
    const playerInfoSubscriptions = new Subscription();
    playerInfoSubscriptions.add(this.playerInfoService.playerJoined$.subscribe(player => {
      this.scheduleJoinLine(player);
    }));
    // Roles follow the stream, so the roster has to be re-stamped whenever host identity
    // changes. Safe to subscribe before the stream service is set up: `hostPeerId$` is a
    // BehaviorSubject, so this just replays the current (null) value first.
    playerInfoSubscriptions.add(this.streamService.hostPeerId$.subscribe(hostPeerId => {
      this.playerInfoService.setHostPeer(hostPeerId);
    }));
    this.playerInfoSubscription = playerInfoSubscriptions;

    this.addOnPeerLeaveHandler((peerId: string) => {
      // Read the name BEFORE the removal handler below deletes it.
      const player = this.playerInfoService.getPlayer(peerId);
      // Nothing was announced, so there is nothing to close off either.
      if (this.cancelJoinLine(peerId)) return;
      if (player) {
        this.chatService.addSystemMessage(`${this.describePlayer(player)} saiu da sala.`);
      }
    });

    this.addOnPeerLeaveHandler((peerId: string) => {
      this.playerInfoService.removePlayer(peerId); // Remove player info for this peer
    });

    const playerIdent = room.makeAction<PlayerIdentMessage>(MULTIPLAYER.EVENTS.PLAYER_IDENT);
    const sendIdent = (peerId: string) => {
      const ident: PlayerIdentMessage = {
        name: this.playerName,
        color: this.playerColor,
        // Deprecated and no longer read on receive — roles are derived from who delivered
        // the video track. Still SENT for one release so a guest running the new code
        // against a host that has not reloaded yet is not the odd case out. Drop the field
        // once no old hosts are in the wild.
        host: (this.playerRole === MultiplayerUserRole.HOST)
      };
      playerIdent.send(ident, { target: peerId });
    };

    // A spectator does not announce itself until it has a host and a picture. Presence means
    // "watching", and one that has not received the stream is not — which matters now that a
    // full room turns spectators away: a refused one lingers for a few seconds (it has to wait
    // out the refusal being a claim) and is, to every other spectator, just another peer. If
    // it announced itself at once, each of them would write "entrou" and then "saiu" into the
    // transcript for someone who was never let in. Held back until `hostPeerId` is set, a
    // refused spectator is never seen at all. A host announces at once: it has nothing to wait for.
    const awaitingHost = new Set<string>();
    this.addOnPeerJoinHandler((peerId: string) => {
      if (this.playerRole === MultiplayerUserRole.GUEST && this.streamService.hostPeerId === null) {
        awaitingHost.add(peerId);
        return;
      }
      sendIdent(peerId);
    });
    this.playerInfoSubscription?.add(
      this.streamService.hostPeerId$.pipe(filter(hostPeerId => hostPeerId !== null)).subscribe(() => {
        awaitingHost.forEach(sendIdent);
        awaitingHost.clear();
      })
    );
    this.addOnPeerLeaveHandler((peerId: string) => awaitingHost.delete(peerId));
  }

  private setupStreamService(stream?: MediaStream) {
    if (!this.room) return;

    this.streamService.setup(this.room, this.playerRole, stream);

    // Only the host bothers with peer join/leave events
    if(this.playerRole === MultiplayerUserRole.HOST && stream) {
      console.log(`Setting up peer join/leave handlers for HOST role`);
      this.addOnPeerJoinHandler((peerId: string) => {
        this.streamService.handlePeerJoin(peerId);
      });
      this.addOnPeerLeaveHandler((peerId: string) => {
        this.streamService.handlePeerLeave(peerId);
      });
    }
  }

  private addOnPeerJoinHandler(handler: (peerId: string) => void) {
    this.onPeerJoinHandlers.push(handler);
  }

  private onPeerJoin(peerId: string) {
    // trystero counts the peer itself now that it is active, so the slot held for it is free
    // to be released. Done before the handlers: one of them can tear the room down.
    this.admissionService.release(peerId);

    // Guarded per iteration: a handler can tear the room down (a host yielding a
    // collided code), and the remaining handlers must not run against cleared state.
    for (const handler of this.onPeerJoinHandlers) {
      if (this.isLeaving) return;
      handler(peerId);
    }
  }

  private addOnPeerLeaveHandler(handler: (peerId: string) => void) {
    this.onPeerLeaveHandlers.push(handler);
  }

  private onPeerLeave(peerId: string) {
    for (const handler of this.onPeerLeaveHandlers) {
      if (this.isLeaving) return;
      handler(peerId);
    }
  }
}
