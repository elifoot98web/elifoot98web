import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Room, selfId } from 'trystero';
import { CursorClickMessage, CursorPositionMessage } from '../../models/multiplayer';
import { MULTIPLAYER } from '../../models/constants';

@Injectable({
  providedIn: 'root'
})
export class MultiplayerCursorService {
  private room?: Room;

  private cursors: { [peerId: string]: CursorPositionMessage } = {};
  private cursorsSubject = new BehaviorSubject<{ [peerId: string]: CursorPositionMessage }>({});

  private clickSubject = new BehaviorSubject<CursorClickMessage | null>(null);

  constructor() { }

  /**
   * Initialize the cursor service with the current room.
   * This should be called after joining a room.
   */
  setup(room: Room) {
    this.room = room;
    // Listen for player pointer (cursor) messages
    const [_, receivePlayerPointer] = this.room.makeAction<CursorPositionMessage>(MULTIPLAYER.EVENTS.PLAYER_CURSOR_POS);
    receivePlayerPointer((data, peerId) => {
      this.updateCursor(peerId, data);
    });

    const [__, receivePlayerClick] = this.room.makeAction<CursorClickMessage>(MULTIPLAYER.EVENTS.PLAYER_CLICK);
    receivePlayerClick((data) => {
      if (data) {
        this.clickSubject.next(data);
      }
    })
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
  getCursorsObservable(): Observable<{ [peerId: string]: CursorPositionMessage }> {
    return this.cursorsSubject.asObservable();
  }

  /**
   * Get observable for cursor click events.
   */
  getClickObservable(): Observable<CursorClickMessage | null> {
    return this.clickSubject.asObservable();
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
  sendLocalCursor(cursor: CursorPositionMessage) {
    if (!this.room) return;
    this.updateCursor(selfId, cursor);
    const [sendCursorPosition] = this.room.makeAction<CursorPositionMessage>(MULTIPLAYER.EVENTS.PLAYER_CURSOR_POS);
    sendCursorPosition(cursor);
  }

  sendLocalClick(click: CursorClickMessage) {
    if (!this.room) return;
    this.clickSubject.next(click)
    const [sendPlayerClick] = this.room.makeAction<CursorClickMessage>(MULTIPLAYER.EVENTS.PLAYER_CLICK);
    sendPlayerClick(click);
  }

  private updateCursor(peerId: string, cursor: CursorPositionMessage) {
    this.cursors[peerId] = cursor;
    this.cursorsSubject.next({ ...this.cursors });
  }

}
