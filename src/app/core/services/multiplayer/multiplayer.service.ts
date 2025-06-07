import { Injectable } from '@angular/core';
import { BaseRoomConfig, joinRoom, Room } from 'trystero';
import { GameState, HostClaimMessage, MultiplayerUserRole, PlayerIdentMessage } from '../../models/multiplayer';
import { MULTIPLAYER } from '../../models/constants';
import { MultiplayerChatService } from './multiplayer-chat.service';
import { MultiplayerCursorService } from './multiplayer-cursor.service';
import { MultiplayerPlayerInfoService } from './multiplayer-player-info.service';
import { BehaviorSubject } from 'rxjs';
import { MultiplayerStreamService } from './multiplayer-stream.service';

@Injectable({
  providedIn: 'root'
})
export class MultiplayerService {
  // This service centralizes the core multiplayer logic, rooms, users which can be used by both host and guest.

  // Game state management
  private state: GameState = GameState.NOT_IN_ROOM;
  private playerName: string = '';
  private roomName: string = '';
  private password: string = '';
  private playerColor: string = '#000000'; // Default color for the player

  private playerRole: MultiplayerUserRole = MultiplayerUserRole.GUEST; // Default role is GUEST

  // Trystero room logic and callbacks
  private room?: Room;
  private onPeerJoinHandlers: ((peerId: string) => void)[] = [];
  private onPeerLeaveHandlers: ((peerId: string) => void)[] = [];

  // Subjects
  gameStateSubject = new BehaviorSubject<GameState>(this.state);

  constructor(
    private multiplayerCursorService: MultiplayerCursorService,
    private playerInfoService: MultiplayerPlayerInfoService,
    private chatService: MultiplayerChatService,
    private streamService: MultiplayerStreamService
  ) { }

  async hostGameRoom(hostName: string, roomName: string, password: string, stream: MediaStream) {
    this.joinRoom(hostName, roomName, password);
    const claimedHost = await this.claimHost();
    if (!claimedHost) {
      this.leaveRoom();
      this.state = GameState.ERROR;
      throw new Error('Host claim failed, another host is already active. Disconnecting from room.');
    }
    this.setupHost(stream);
  }

  async joinGameRoom(playerName: string, roomName: string, password: string): Promise<void> {
    this.joinRoom(playerName, roomName, password);
    this.setupGuest()
  }

  leaveRoom() {
    if (this.room) {
      this.room.leave();
      this.room = undefined;
      this.state = GameState.NOT_IN_ROOM;
      this.playerRole = MultiplayerUserRole.GUEST; // Reset role
      this.playerName = '';

      this.onPeerJoinHandlers = []; // Clear join handlers
      this.onPeerLeaveHandlers = []; // Clear leave handlers

      // Clear services
      this.playerInfoService.clear();
      this.multiplayerCursorService.clear();
      this.chatService.clear();
      this.streamService.clear(); // Clear stream service state
      console.log('Left the multiplayer room and reset service state.');
    }
  }

  private joinRoom(playerName: string, roomName: string, password: string, color?: string): void {
    if (this.room) throw new Error('Already in a room. Please leave the current room before joining a new one.');

    this.state = GameState.JOINING_ROOM;

    this.playerName = playerName;
    this.roomName = roomName;
    this.password = password;
    this.playerColor = color || '#000000'; // Default to black if no color provided

    const config: BaseRoomConfig = {
      appId: MULTIPLAYER.APP_ID,
      password: this.password
    }
    this.room = joinRoom(config, this.roomName);

    this.state = GameState.IN_ROOM;
    this.initPeerListeners(); // Initialize peer listeners for join/leave events

    // Setup shared services
    this.setupCursorService();
    this.setupPlayerInfoService();
    this.setupChatService();
  }

  private async initPeerListeners() {
    if (!this.room) throw new Error('Room is not initialized');

    this.room.onPeerJoin((peerId) => {
      this.onPeerJoin(peerId);
    })

    this.room.onPeerLeave((peerId) => {
      this.onPeerLeave(peerId);
    })
  }

  private async claimHost(): Promise<boolean> {
    if (!this.room) throw new Error('Room is not initialized');

    const [sendHostClaim, receiveHostClaim] = this.room.makeAction<HostClaimMessage>(MULTIPLAYER.EVENTS.HOST_CLAIM);

    let reclaimed = false;

    // Listen for host claims from other peers during the initial timeout
    receiveHostClaim((data, peerId) => {
      reclaimed = true;
      console.warn(`Host claim received from ${peerId}:`, data);
    });

    // Broadcast our host claim continuously until timeout
    const hostClaimInterval = setInterval(() => {
      if (reclaimed) {
        clearInterval(hostClaimInterval); // Stop sending if we detected a reclaim
        return;
      }
      sendHostClaim({ hostName: this.playerName });
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
    
    this.playerRole = MultiplayerUserRole.GUEST;
    this.setupStreamService();
  }

  private setupHost(stream: MediaStream) {
    if (!this.room) return;
    
    this.playerRole = MultiplayerUserRole.HOST;

    // Setup host claim listener
    const [sendHostClaim, receiveHostClaim] = this.room.makeAction<HostClaimMessage>(MULTIPLAYER.EVENTS.HOST_CLAIM);
    receiveHostClaim((data, peerId) => {
      console.warn(`Host claim attempt received from ${peerId}:`, data);
      // If we receive a claim after our own, we resend our claim to let 
      // the other host candidate know we are still active
      sendHostClaim({ hostName: this.playerName || 'Host' })
    })
    
    this.setupStreamService(stream);
  }

  private setupChatService() {
    if (!this.room) return;

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

    this.addOnPeerLeaveHandler((peerId: string) => {
      this.playerInfoService.removePlayer(peerId); // Remove player info for this peer
    });

    const [sendPlayerIdent] = room.makeAction<PlayerIdentMessage>(MULTIPLAYER.EVENTS.PLAYER_IDENT);
    this.addOnPeerJoinHandler((peerId: string) => {
      // When a new peer joins, send them the current player ident
      const playerIdent: PlayerIdentMessage = {
        name: this.playerName,
        color: this.playerColor,
        host: (this.playerRole === MultiplayerUserRole.HOST)
      };
      sendPlayerIdent(playerIdent, peerId);
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
