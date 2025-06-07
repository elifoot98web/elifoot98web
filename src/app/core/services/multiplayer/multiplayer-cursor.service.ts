import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Room, selfId } from 'trystero';
import { PlayerCursorMessage } from '../../models/multiplayer';
import { MULTIPLAYER } from '../../models/constants';

@Injectable({
  providedIn: 'root'
})
export class MultiplayerCursorService {
  private room?: Room;

  private cursors: { [peerId: string]: PlayerCursorMessage } = {};
  private cursorsSubject = new BehaviorSubject<{ [peerId: string]: PlayerCursorMessage }>({});

  constructor() { }

  /**
   * Initialize the cursor service with the current room.
   * This should be called after joining a room.
   */
  setup(room: Room) {
    this.room = room;
    // Listen for player pointer (cursor) messages
    const [_, receivePlayerPointer] = this.room.makeAction<PlayerCursorMessage>(MULTIPLAYER.EVENTS.PLAYER_POINTER);
    receivePlayerPointer((data, peerId) => {
      this.updateCursor(peerId, data);
    });
  }

  /**
   * Remove a cursor for a peer
  */
  removeCursor(peerId: string) {
    delete this.cursors[peerId];
    this.cursorsSubject.next({ ...this.cursors });
  }

  /**
   * Get observable for all cursors
  */
  getCursorsObservable(): Observable<{ [peerId: string]: PlayerCursorMessage }> {
    return this.cursorsSubject.asObservable();
  }

  /**
   * Clear all cursors (e.g., on room leave)
  */
  clear() {
    this.cursors = {};
    this.cursorsSubject.next({});
  }

  /**
   * Send local cursor update: update local state and send to peers
  */
  sendLocalCursor(cursor: PlayerCursorMessage) {
    if (!this.room) return;
    this.updateCursor(selfId, cursor);
    const [sendPlayerPointer] = this.room.makeAction<PlayerCursorMessage>(MULTIPLAYER.EVENTS.PLAYER_POINTER);
    sendPlayerPointer(cursor);
  }

  private updateCursor(peerId: string, cursor: PlayerCursorMessage) {
    this.cursors[peerId] = cursor;
    this.cursorsSubject.next({ ...this.cursors });
  }
}
