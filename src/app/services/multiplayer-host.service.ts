import { Injectable } from '@angular/core';
import { BaseRoomConfig, joinRoom, Room, selfId } from 'trystero';
import { MULTIPLAYER } from '../models/constants';
import { HostClaimMessage, PlayerCursorMessage, PlayerListMessage } from '../models/multiplayer.models';
import { MultiplayerCursorService } from './multiplayer-cursor.service';

/**
 * MultiplayerHostService manages the lifecycle and logic for hosting a multiplayer game room.
 * It handles room creation, player management, host conflict resolution, and broadcasting player lists.
 */
@Injectable({
  providedIn: 'root'
})
export class MultiplayerHostService {
  /** The Trystero room instance, or undefined if not initialized */
  private room: Room | undefined;
  /** The name of the host (local user) */
  private hostName: string = 'Game Host'
  /** Map of peerId to player name for all connected players (excluding host) */
  private players: { [peerId: string]: string } = {};

  constructor(private multiplayerCursorService: MultiplayerCursorService) { }

  /**
   * Returns the current list of players as an array of objects with peerId and playerName.
   * Host is not included in this list.
   */
  get playerList() {
    return Object.entries(this.players).map(([peerId, playerName]) => ({
      peerId,
      playerName
    }));
  }

  /**
   * Creates and initializes a new multiplayer game room as host.
   * @param hostName The display name for the host
   * @param roomName The unique name of the room
   * @param password The password for joining the room
   * @param stream The media stream to share with peers
   * @throws Error if room setup fails (e.g., host conflict)
   */
  async createGameRoom(hostName: string, roomName: string, password: string, stream: MediaStream) {
    this.hostName = hostName;
    
    const config: BaseRoomConfig = {
      appId: MULTIPLAYER.APP_ID,
      password: password,
    }
    
    this.room = joinRoom(config, roomName)
    try {
      await this.setupRoom(stream);
    } catch (error) {
      console.error('Error setting up game room:', error);
      this.closeGameRoom();
      throw error; // Re-throw the error to handle it in the calling context
    }
  }

  /**
   * Closes the current game room, disconnects all peers, and resets state.
   */
  closeGameRoom() {
    this.room?.leave()
    this.room = undefined;
    this.hostName = 'Game Host';
    this.players = {};
    this.multiplayerCursorService.clear(); // Clear any cursor data
    console.log('Game room closed and resources cleaned up.');
  }

  /**
   * Sets up the room by resolving host conflicts and initializing player listeners.
   * @param stream The media stream to share with peers
   */
  private async setupRoom(stream: MediaStream) {
    await this.setupHostConflict()
    await this.setupPlayerListeners(stream);
  }

  /**
   * Sets up listeners for player join/leave events and player identity messages.
   * Adds new players to the list and broadcasts updates.
   * @param stream The media stream to share with new peers
   */
  private async setupPlayerListeners(stream: MediaStream) {
    if (!this.room) throw new Error('Room is not initialized');

    // When a new peer joins, assign a random player name and add their stream
    this.room.onPeerJoin((peerId) => {
      console.log(`Player joined: ${peerId}`);
      const randomId = Math.random().toString(10).substring(2, 8);
      this.players[peerId] = `Jogador #${randomId}`;
      this.broadcastPlayerList();
      this.room?.addStream(stream, peerId)
    });

    // When a peer leaves, remove them from the player list
    this.room.onPeerLeave((peerId) => {
      console.log(`Player left: ${peerId}`);
      delete this.players[peerId];
      this.broadcastPlayerList();
      this.room?.removeStream(stream, peerId);
    });

    // Listen for player identity messages and update player names accordingly
    const [_sendPlayerIdent, receivePlayerIdent] = this.room.makeAction<string>(MULTIPLAYER.EVENTS.PLAYER_IDENT);
    receivePlayerIdent((name, peerId) => {
      console.log(`Player identity received from ${peerId}:`, name);
      this.players[peerId] = name;
      this.broadcastPlayerList();
    });

    const [_sendPlayerPointer, receivePlayerPointer]  = this.room.makeAction<PlayerCursorMessage>(MULTIPLAYER.EVENTS.PLAYER_POINTER);
    receivePlayerPointer((data, peerId) => {
      this.multiplayerCursorService.updateCursor(peerId, data);
    });
  }

  /**
   * Resolves host conflicts by broadcasting a host claim and waiting for responses.
   * If another host is detected, setup is aborted.
   * @throws Error if a host conflict is detected
   */
  private async setupHostConflict() {
    if (!this.room) throw new Error('Room is not initialized');

    const [sendHostClaim, receiveHostClaim] = this.room.makeAction<HostClaimMessage>(MULTIPLAYER.EVENTS.HOST_CLAIM);

    let claimed = false;
    
    // Listen for host claims from other peers during the initial timeout
    receiveHostClaim((data, peerId) => {
      claimed = true;
      console.warn(`Host claim received from ${peerId}:`, data);
    });

    // Broadcast our own host claim
    sendHostClaim({
      hostName: this.hostName,
      hostId: selfId
    })

    // Wait for a period to detect any host conflicts
    await new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        if (!claimed) {
          console.log('No host conflict detected, proceeding with room setup.');
          resolve();
        } else {
          console.error('Host conflict detected, cannot proceed with room setup.');
          reject(new Error('Host conflict detected'));
        }
      }, MULTIPLAYER.HOST_CLAIM_TIMEOUT);
    })

    // After initial check, continue to respond to late host claims to assert our host status
    receiveHostClaim((data, peerId) => {
      console.warn(`Host claim attempt received from ${peerId}:`, data);
      // If we receive a claim after our own, we resend our claim to let 
      // the other host candidate know we are still active
      sendHostClaim({
        hostName: this.hostName,
        hostId: selfId
      })
    })
  }

  /**
   * Broadcasts the current player list (including host) to all peers.
   * Used to keep all clients in sync with the latest player information.
   */
  private broadcastPlayerList() {
    if (!this.room) {
      console.error('Room is not initialized, cannot broadcast player list');
      return;
    }
    const [sendPlayerList] = this.room.makeAction<PlayerListMessage>(MULTIPLAYER.EVENTS.PLAYER_LIST);

    // Include the host in the broadcasted player list
    const players = Object.assign({}, this.players, { [selfId]: this.hostName });

    sendPlayerList({ players });
  }
}
