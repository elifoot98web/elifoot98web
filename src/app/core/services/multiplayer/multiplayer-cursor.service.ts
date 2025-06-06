import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Room, selfId } from 'trystero';
import { PlayerCursorMessage } from '../../models/multiplayer';
import { MULTIPLAYER } from '../../models/constants';

@Injectable({
  providedIn: 'root'
})
export class MultiplayerCursorService {
  room: Room | undefined;

  private cursors: { [peerId: string]: PlayerCursorMessage } = {};
  private cursorsSubject = new BehaviorSubject<{ [peerId: string]: PlayerCursorMessage }>({});

  constructor() { }

  /**
   * Update or add a cursor for a peer
   */
  updateCursor(peerId: string, cursor: PlayerCursorMessage) {
    this.cursors[peerId] = cursor;
    this.cursorsSubject.next({ ...this.cursors });
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
  sendLocalCursor(cursor: PlayerCursorMessage, room: Room) {
    this.updateCursor(selfId, cursor);
    const [sendPlayerPointer] = room.makeAction<PlayerCursorMessage>(MULTIPLAYER.EVENTS.PLAYER_POINTER);
    sendPlayerPointer(cursor);
  }
}
