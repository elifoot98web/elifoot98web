import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Room, selfId } from 'trystero';
import { MultiplayerChatMessage } from '../../models/multiplayer';
import { MULTIPLAYER } from '../../models/constants';

@Injectable({
  providedIn: 'root'
})
export class MultiplayerChatService {
  private messages: MultiplayerChatMessage[] = [];
  private messagesSubject = new BehaviorSubject<MultiplayerChatMessage[]>([]);
  private room?: Room;

  // Unread tracking lives here rather than in the chat component because the badge is
  // rendered by the pages, outside the collapsed sidebar that holds the component.
  private unreadCountSubject = new BehaviorSubject<number>(0);
  private readMessageCount = 0;
  private isChatVisible = false;

  unreadCount$ = this.unreadCountSubject.asObservable();

  constructor() {}

  /**
   * Call this to setup chat listeners for a room
   */
  setup(room: Room) {
    this.room = room;
    const chatMessage = room.makeAction<MultiplayerChatMessage>(MULTIPLAYER.EVENTS.CHAT_MESSAGE);
    chatMessage.onMessage = (msg, { peerId }) => {
      // Anything off the wire is a user message by definition: system lines are generated
      // locally, so accepting a remote `kind: 'system'` would let a peer forge one. The
      // sender is taken from the transport rather than the payload for the same reason.
      this.addMessage({ ...msg, senderId: peerId, kind: 'user' });
    };
  }

  /**
   * Send a chat message to peers
   */
  sendMessage(text: string) {
    if (!this.room) {
      console.warn('Chat room not set up. Call setup(room) first.');
      return;
    }

    if (!text || text.trim() === '') {
      console.warn('Cannot send empty message');
      return;
    }

    // Stamped by the sender rather than each receiver, so every participant
    // orders the conversation the same way.
    const msg: MultiplayerChatMessage = {
      id: this.generateId(),
      senderId: selfId,
      text: text.trim(),
      timestamp: Date.now(),
      kind: 'user',
    };
    this.addMessage(msg); // add locally

    this.room.makeAction<MultiplayerChatMessage>(MULTIPLAYER.EVENTS.CHAT_MESSAGE).send(msg);
  }

  /**
   * Append a local-only line to the transcript ("Fulano entrou na sala.").
   *
   * Never sent over the wire: every peer observes joins and leaves for itself, so
   * broadcasting would give everyone duplicates. It also never raises the unread badge —
   * the read cursor is advanced past it — because a badge that fires on every network
   * hiccup trains people to ignore it.
   */
  addSystemMessage(text: string) {
    const wasRead = this.readMessageCount === this.messages.length;

    this.addMessage({
      id: this.generateId(),
      senderId: '',
      text,
      timestamp: Date.now(),
      kind: 'system',
    });

    if (wasRead) this.markAllAsRead();
  }

  /**
   * Get observable for chat messages
   */
  getMessagesObservable(): Observable<MultiplayerChatMessage[]> {
    return this.messagesSubject.asObservable();
  }

  /**
   * Track whether the chat is on screen. While it is hidden, arriving messages
   * accumulate into the unread count instead of counting as seen.
   */
  setChatVisible(visible: boolean) {
    this.isChatVisible = visible;
    if (visible) this.markAllAsRead();
  }

  markAllAsRead() {
    this.readMessageCount = this.messages.length;
    this.unreadCountSubject.next(0);
  }

  /**
   * Clear chat (e.g., on room leave)
   */
  clear() {
    this.room = undefined;
    this.messages = [];
    this.messagesSubject.next([]);
    this.readMessageCount = 0;
    this.isChatVisible = false;
    this.unreadCountSubject.next(0);
  }

  private addMessage(msg: MultiplayerChatMessage) {
    // Prevent duplicates by id
    if (this.messages.some(m => m.id === msg.id)) return;

    this.messages.push(msg);
    this.messages.sort((a, b) => a.timestamp - b.timestamp);
    this.messagesSubject.next([...this.messages]);

    if (this.isChatVisible) {
      this.markAllAsRead();
    } else {
      this.unreadCountSubject.next(this.messages.length - this.readMessageCount);
    }
  }

  private generateId(): string {
    return selfId.slice(0, 8) + Math.random().toString(36).slice(2);
  }
}
