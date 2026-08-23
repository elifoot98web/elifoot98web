import { Injectable } from '@angular/core';
import { joinRoom, JoinRoomConfig, Room } from 'trystero';
import { GameState, HostClaimMessage, MultiplayerUserRole, PlayerIdentMessage } from '../../models/multiplayer';
import { MULTIPLAYER } from '../../models/constants';
import { MultiplayerChatService } from './multiplayer-chat.service';
import { MultiplayerCursorService } from './multiplayer-cursor.service';
import { MultiplayerPlayerInfoService } from './multiplayer-player-info.service';
import { BehaviorSubject } from 'rxjs';
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
  private onPeerJoinHandlers: ((peerId: string) => void)[] = [];
  private onPeerLeaveHandlers: ((peerId: string) => void)[] = [];

  // Subjects
  gameStateSubject = new BehaviorSubject<GameState>(GameState.NOT_IN_ROOM);

  constructor(
    private multiplayerCursorService: MultiplayerCursorService,
    private playerInfoService: MultiplayerPlayerInfoService,
    private chatService: MultiplayerChatService,
    private streamService: MultiplayerStreamService
  ) { }

  get isInRoom(): boolean {
    return this.room !== undefined;
  }

  async hostGameRoom(hostName: string, roomName: string, password: string, stream: MediaStream, color?: string) {
    this.joinRoom(hostName, roomName, password, MultiplayerUserRole.HOST, color);
    const claimedHost = await this.claimHost();
    if (!claimedHost) {
      this.leaveRoom(GameState.ERROR);
      throw new Error('Já existe outro anfitrião nesta sala. Escolha outro código de sala.');
    }
    this.setupHost(stream);
  }

  async joinGameRoom(playerName: string, roomName: string, password: string, color?: string): Promise<void> {
    this.joinRoom(playerName, roomName, password, MultiplayerUserRole.GUEST, color);
    this.setupGuest()
  }

  /**
   * Tear down the room and reset all multiplayer state.
   *
   * @param nextState the state to settle on. Callers that are leaving *because* of a
   *   condition worth reporting (the host vanished, say) pass that state so it is not
   *   overwritten by the default idle state.
   */
  leaveRoom(nextState: GameState = GameState.NOT_IN_ROOM) {
    this.room?.leave();
    this.room = undefined;

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

  private joinRoom(playerName: string, roomName: string, password: string, role: MultiplayerUserRole, color?: string): void {
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
    this.room = joinRoom(config, this.roomName.toLocaleUpperCase()); // Use uppercase room name for consistency

    this.initPeerListeners(); // Initialize peer listeners for join/leave events

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

    // Setup shared services
    this.setupCursorService();
    this.setupPlayerInfoService();
    this.setupChatService();
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

  private async claimHost(): Promise<boolean> {
    if (!this.room) throw new Error('Room is not initialized');

    const hostClaim = this.room.makeAction<HostClaimMessage>(MULTIPLAYER.EVENTS.HOST_CLAIM);

    let reclaimed = false;

    // Listen for host claims from other peers during the initial timeout
    hostClaim.onMessage = (data, { peerId }) => {
      reclaimed = true;
      console.warn(`Host claim received from ${peerId}:`, data);
    };

    // Broadcast our host claim continuously until timeout
    const hostClaimInterval = setInterval(() => {
      if (reclaimed) {
        clearInterval(hostClaimInterval); // Stop sending if we detected a reclaim
        return;
      }
      hostClaim.send({ hostName: this.playerName });
    }, MULTIPLAYER.HOST_CLAIM_INTERVAL);

    // Wait for a period to detect any host reclaim conflicts
    const sucessHostClaim = await new Promise<boolean>((resolve) => {
      setTimeout(() => {
        if (!reclaimed) {
          console.log('No host conflict detected, claiming host status.');
        } else {
          console.warn('Host conflict detected, cannot proceed with room setup.');
        }
        resolve(!reclaimed);
      }, MULTIPLAYER.HOST_CLAIM_TIMEOUT);
    });
    clearInterval(hostClaimInterval); // Clear the interval after timeout

    return sucessHostClaim;
  }

  private setupGuest() {
    if (!this.room) return;

    this.setState(GameState.WAITING_STREAM);
    this.setupStreamService();
  }

  private setupHost(stream: MediaStream) {
    if (!this.room) return;

    // Setup host claim listener
    const hostClaim = this.room.makeAction<HostClaimMessage>(MULTIPLAYER.EVENTS.HOST_CLAIM);
    hostClaim.onMessage = (data, { peerId }) => {
      console.warn(`Host claim attempt received from ${peerId}:`, data);
      // If we receive a claim after our own, we resend our claim to let
      // the other host candidate know we are still active
      hostClaim.send({ hostName: this.playerName || 'Host' })
    }

    this.setupStreamService(stream);
    this.setState(GameState.IN_ROOM);
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
    this.onPeerJoinHandlers.forEach(handler => handler(peerId));
  }

  private addOnPeerLeaveHandler(handler: (peerId: string) => void) {
    this.onPeerLeaveHandlers.push(handler);
  }

  private onPeerLeave(peerId: string) {
    this.onPeerLeaveHandlers.forEach(handler => handler(peerId));
  }
}
