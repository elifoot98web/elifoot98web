import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Room, selfId } from 'trystero';
import { CursorClickMessage, CursorPositionMessage } from '../../models/multiplayer';
import { MULTIPLAYER } from '../../models/constants';
import { WireGuardHelper } from '../../helpers/wire-guard.helper';

@Injectable({
  providedIn: 'root'
})
export class MultiplayerCursorService {
  private room?: Room;

  private cursors: { [peerId: string]: CursorPositionMessage } = {};
  private cursorsSubject = new BehaviorSubject<{ [peerId: string]: CursorPositionMessage }>({});

  private clickSubject = new BehaviorSubject<CursorClickMessage | null>(null);

  // Outgoing cursor throttling
  private pendingCursor?: CursorPositionMessage;
  private cursorFlushTimer?: ReturnType<typeof setTimeout>;

  constructor() { }

  /**
   * Initialize the cursor service with the current room.
   * This should be called after joining a room.
   */
  setup(room: Room) {
    this.room = room;
    // Listen for player pointer (cursor) messages
    const cursorPosition = this.room.makeAction<CursorPositionMessage>(MULTIPLAYER.EVENTS.PLAYER_CURSOR_POS);
    cursorPosition.onMessage = (data, { peerId }) => {
      // Sanitised here rather than in the renderer because both consumers are DOM writers
      // reached from a subscription: `CursorRendererHelper.renderCursors` calls
      // `ColorHelper.getCSSFilterFromColor`, which throws on an unparseable hex, and the
      // coordinates are multiplied by the container's offset size, where a non-finite
      // value yields NaN. Cursors are shared, so one peer's bad payload is everyone's
      // broken overlay.
      this.updateCursor(peerId, {
        ...data,
        x: WireGuardHelper.unitInterval(data.x),
        y: WireGuardHelper.unitInterval(data.y),
        color: WireGuardHelper.color(data.color),
        name: WireGuardHelper.text(data.name, MULTIPLAYER.WIRE_MAX_NAME_LENGTH),
      });
    };

    const playerClick = this.room.makeAction<CursorClickMessage>(MULTIPLAYER.EVENTS.PLAYER_CLICK);
    playerClick.onMessage = (data) => {
      if (data) {
        this.clickSubject.next({
          ...data,
          x: WireGuardHelper.unitInterval(data.x),
          y: WireGuardHelper.unitInterval(data.y),
          color: WireGuardHelper.color(data.color),
        });
      }
    }
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
    clearTimeout(this.cursorFlushTimer);
    this.cursorFlushTimer = undefined;
    this.pendingCursor = undefined;
    this.room = undefined;
    this.cursors = {};
    this.cursorsSubject.next({});
    this.clickSubject.next(null);
  }

  /**
   * Send local cursor update: update local state and send to peers.
   *
   * Pointer events fire far faster than anyone can perceive, and every send competes with
   * the video stream for bandwidth, so outgoing positions are coalesced: the latest
   * position wins and is flushed at most once per throttle window.
  */
  sendLocalCursor(cursor: CursorPositionMessage) {
    if (!this.room) return;
    this.updateCursor(selfId, cursor);

    this.pendingCursor = cursor;
    if (this.cursorFlushTimer !== undefined) return;

    this.flushCursor();
    this.cursorFlushTimer = setTimeout(() => {
      this.cursorFlushTimer = undefined;
      // Flush whatever arrived while we were throttling, so the cursor never
      // comes to rest on a stale position.
      if (this.pendingCursor) this.flushCursor();
    }, MULTIPLAYER.CURSOR_SEND_THROTTLE_MS);
  }

  sendLocalClick(click: CursorClickMessage) {
    if (!this.room) return;
    this.clickSubject.next(click)
    this.room.makeAction<CursorClickMessage>(MULTIPLAYER.EVENTS.PLAYER_CLICK).send(click);
  }

  private flushCursor() {
    if (!this.room || !this.pendingCursor) return;
    this.room.makeAction<CursorPositionMessage>(MULTIPLAYER.EVENTS.PLAYER_CURSOR_POS).send(this.pendingCursor);
    this.pendingCursor = undefined;
  }

  private updateCursor(peerId: string, cursor: CursorPositionMessage) {
    this.cursors[peerId] = cursor;
    this.cursorsSubject.next({ ...this.cursors });
  }

}
