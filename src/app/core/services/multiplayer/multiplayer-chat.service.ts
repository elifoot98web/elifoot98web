import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Room, selfId } from 'trystero';
import { MultiplayerChatMessage, MultiplayerChatMessageWithTimestamp } from '../../models/multiplayer';
import { MULTIPLAYER } from '../../models/constants';

@Injectable({
  providedIn: 'root'
})
export class MultiplayerChatService {
  private messages: MultiplayerChatMessageWithTimestamp[] = [];
  private messagesSubject = new BehaviorSubject<MultiplayerChatMessageWithTimestamp[]>([]);
  private room?: Room;

  constructor() {}

  /**
   * Call this to setup chat listeners for a room
   */
  setup(room: Room) {
    const [_, onChatMessage] = room.makeAction<MultiplayerChatMessage>(MULTIPLAYER.EVENTS.CHAT_MESSAGE);
    onChatMessage((msg) => {
      this.addMessage(msg);
    });
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

    const msg: MultiplayerChatMessage = {
      id: this.generateId(),
      senderId: selfId,
      text: text.trim(),
    };
    this.addMessage(msg); // add locally
    
    const [sendChatMessage] = this.room.makeAction<MultiplayerChatMessage>(MULTIPLAYER.EVENTS.CHAT_MESSAGE);
    sendChatMessage(msg);
  }

  /**
   * Get observable for chat messages
   */
  getMessagesObservable(): Observable<MultiplayerChatMessage[]> {
    return this.messagesSubject.asObservable();
  }

  /**
   * Clear chat (e.g., on room leave)
   */
  clear() {
    this.messages = [];
    this.messagesSubject.next([]);
  }

  private addMessage(msg: MultiplayerChatMessage) {
    const messageWithTimestamp: MultiplayerChatMessageWithTimestamp = {
        ...msg,
        timestamp: Date.now()
    }

    // Prevent duplicates by id
    if (!this.messages.find(m => m.id === msg.id)) {
      this.messages.push(messageWithTimestamp);
      this.messagesSubject.next([...this.messages]);
    }
  }

  private generateId(): string {
    return selfId.slice(0, 8) + Math.random().toString(36).slice(2);
  }
}
