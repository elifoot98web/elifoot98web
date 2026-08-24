import { Injectable } from '@angular/core';
import { JoinError, joinRoom, JoinRoomConfig, RequestAction, Room, selfId } from 'trystero';
import {
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
import { BehaviorSubject, Subject, Subscription } from 'rxjs';
import { MultiplayerStreamService } from './multiplayer-stream.service';
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
    private streamService: MultiplayerStreamService
  ) { }

  get isInRoom(): boolean {
    return this.room !== undefined;
  }

  /** True while a previous room is still tearing down. Callers may show a hint. */
  get isDraining(): boolean {
    return this.leavingPromise !== undefined;
  }

  async hostGameRoom(hostName: string, roomName: string, password: string, stream: MediaStream, color?: string) {
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
    if (this.gameStateSubject.value !== state) {
      this.gameStateSubject.next(state);
    }
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

    this.setState(GameState.JOINING_ROOM);

    this.playerName = playerName;
    this.roomName = roomName;
    this.password = password;
    this.playerRole = role;
    this.playerColor = color || MULTIPLAYER.DEFAULT_CURSOR_COLOR;

    const config: JoinRoomConfig = {
      appId: MULTIPLAYER.APP_ID,
      password: this.password,
      turnConfig: environment.multiplayerConfig.turnConfig
    }
    const room = joinRoom(config, this.roomName.toUpperCase(), {
      onJoinError: details => this.handleJoinError(details),
    });
    this.room = room;

    this.initPeerListeners(); // Initialize peer listeners for join/leave events

    // Registered on both roles: a host asks joining peers what they are in order to
    // notice a collision, and a guest can be asked in turn.
    this.roleQuery = room.makeAction<RoleQueryRequest, RoleDescriptor>(
      MULTIPLAYER.EVENTS.ROLE_QUERY,
      { kind: 'request', onRequest: () => this.describeSelf() }
    );

    // Registered before the player info service, whose own leave handler deletes the
    // PlayerInfo this check reads. Handlers run in registration order.
    if (role === MultiplayerUserRole.GUEST) {
      this.addOnPeerLeaveHandler((peerId: string) => {
        if (this.playerInfoService.getPlayer(peerId)?.role === MultiplayerUserRole.HOST) {
          console.warn(`Host ${peerId} left the room.`);
          this.setState(GameState.HOST_LEFT);
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
      this.resolveHostCollision(peerId, data.hostingForMs ?? 0);
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
      if (peer?.role === 'host') this.resolveHostCollision(peerId, peer.hostingForMs ?? 0);
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

    if (!this.shouldYieldRoom(peerId, theirHostingForMs)) {
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
    // observes these events for themselves, so sending them would duplicate them.
    this.playerInfoSubscription?.unsubscribe();
    this.playerInfoSubscription = this.playerInfoService.playerJoined$.subscribe(player => {
      this.chatService.addSystemMessage(`${this.describePlayer(player)} entrou na sala.`);
    });

    this.addOnPeerLeaveHandler((peerId: string) => {
      // Read the name BEFORE the removal handler below deletes it.
      const player = this.playerInfoService.getPlayer(peerId);
      if (player) {
        this.chatService.addSystemMessage(`${this.describePlayer(player)} saiu da sala.`);
      }
    });

    this.addOnPeerLeaveHandler((peerId: string) => {
      this.playerInfoService.removePlayer(peerId); // Remove player info for this peer
    });

    const playerIdent = room.makeAction<PlayerIdentMessage>(MULTIPLAYER.EVENTS.PLAYER_IDENT);
    this.addOnPeerJoinHandler((peerId: string) => {
      // When a new peer joins, send them the current player ident
      const ident: PlayerIdentMessage = {
        name: this.playerName,
        color: this.playerColor,
        host: (this.playerRole === MultiplayerUserRole.HOST)
      };
      playerIdent.send(ident, { target: peerId });
    });
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
