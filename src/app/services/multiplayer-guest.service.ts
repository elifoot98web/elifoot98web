import { Injectable } from '@angular/core';
import { BaseRoomConfig, joinRoom, Room } from 'trystero';
import { MULTIPLAYER } from '../models/constants';
import { PlayerCursorMessage, PlayerListMessage } from '../models/multiplayer.models';

/**
 * MultiplayerGuestService manages the logic for joining a multiplayer game as a guest.
 * Handles joining a room, receiving the host's stream, sending/receiving player identity and cursor messages,
 * and maintaining the player list.
 */
@Injectable({
  providedIn: 'root'
})
export class MultiplayerGuestService {
  /** The Trystero room instance, or undefined if not initialized */
  private room: Room | undefined;
  /** The guest's display name */
  private playerName: string = 'Jogador';
  /** Map of peerId to player name for all connected players (including host) */
  private players: { [peerId: string]: string } = {};
  /** The host's stream, if received */
  private hostStream: MediaStream | undefined;
  /** Listener for host stream updates */
  private hostStreamListener: ((stream: MediaStream) => void) = () => {};

  constructor() { }

  /**
   * Returns the current list of players as an array of objects with peerId and playerName.
   */
  get playerList() {
    return Object.entries(this.players).map(([peerId, playerName]) => ({
      peerId,
      playerName
    }));
  }

  /**
   * Returns the host's stream, if available.
   */
  getHostStream(): MediaStream | undefined {
    return this.hostStream;
  }

  /**
   * Sets a listener that will be called when the host's stream is received.
   * If the stream is already available, it will call the listener immediately.
   * @param listener The function to call with the host's MediaStream
   */
  onHostStream(listener: ((stream: MediaStream) => void)): void {
    this.hostStreamListener = listener;
    if (this.hostStream) {
      listener(this.hostStream); // Call immediately if stream is already available
    }
  }

  /**
   * Joins a multiplayer game room as a guest.
   * @param playerName The display name for this guest
   * @param roomName The name of the room to join
   * @param password The password for the room
   * @returns Promise that resolves when joined and stream is received
   */
  async joinGameRoom(playerName: string, roomName: string, password: string): Promise<void> {
    this.playerName = playerName;

    const config: BaseRoomConfig = {
      appId: MULTIPLAYER.APP_ID,
      password: password,
    };

    this.room = joinRoom(config, roomName);

    await this.setupPlayerListeners();
    await this.sendPlayerIdentity();
  }

  /**
   * Leaves the current game room and cleans up state.
   */
  leaveGameRoom() {
    this.room?.leave();
    this.room = undefined;
    this.players = {};
    this.hostStream = undefined;
    this.playerName = 'Jogador';
    console.log('Left game room and cleaned up resources.');
  }

  /**
   * Sets up listeners for receiving the host's stream, player list updates, and player pointer messages.
   */
  private async setupPlayerListeners() {
    if (!this.room) throw new Error('Room is not initialized');

    // Listen for the host's stream
    this.room.onPeerStream((stream, peerId) => {
      // Assume the first stream received is from the host
      this.hostStream = stream;
      this.hostStreamListener(stream); // Notify listener immediately
      console.log(`Received host stream from ${peerId}`);
    });

    // Listen for player list updates from the host
    const [_sendPlayerList, receivePlayerList] = this.room.makeAction<PlayerListMessage>(MULTIPLAYER.EVENTS.PLAYER_LIST);
    receivePlayerList((data) => {
      this.players = data.players;
      console.log('Player list updated:', this.players);
    });

    // Listen for player pointer (cursor) messages from other players
    const [_sendPlayerPointer, receivePlayerPointer] = this.room.makeAction<PlayerCursorMessage>(MULTIPLAYER.EVENTS.PLAYER_POINTER);
    receivePlayerPointer((data, peerId) => {
      // TODO: Handle displaying the cursor for peerId at (data.x, data.y) with data.color
      console.log(`Player ${peerId} cursor at (${data.x}, ${data.y}) with color ${data.color}`);
    });
  }

  /**
   * Sends this player's identity to the host.
   */
  private async sendPlayerIdentity() {
    if (!this.room) throw new Error('Room is not initialized');
    const [sendPlayerIdent] = this.room.makeAction<string>(MULTIPLAYER.EVENTS.PLAYER_IDENT);
    sendPlayerIdent(this.playerName);
  }

  /**
   * Sends a player pointer (cursor) message to other peers.
   * @param cursor The cursor message to send
   */
  sendPlayerPointer(cursor: PlayerCursorMessage) {
    if (!this.room) return;
    const [sendPlayerPointer] = this.room.makeAction<PlayerCursorMessage>(MULTIPLAYER.EVENTS.PLAYER_POINTER);
    sendPlayerPointer(cursor);
  }
}
