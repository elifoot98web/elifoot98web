import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Room, selfId } from 'trystero';
import { MULTIPLAYER } from '../models/constants';
import { MultiplayerChatMessage, MultiplayerChatMessageWithTimestamp } from '../models/multiplayer.models';

@Injectable({
  providedIn: 'root'
})
export class MultiplayerChatService {
  private messages: MultiplayerChatMessageWithTimestamp[] = [];
  private messagesSubject = new BehaviorSubject<MultiplayerChatMessageWithTimestamp[]>([]);

  constructor() {}

  /**
   * Call this to setup chat listeners for a room
   */
  bindRoom(room: Room) {
    const [_, onChatMessage] = room.makeAction<MultiplayerChatMessage>(MULTIPLAYER.EVENTS.CHAT_MESSAGE);
    onChatMessage((msg) => {
      this.addMessage(msg);
    });
  }

  /**
   * Send a chat message to peers
   */
  sendMessage(room: Room, text: string, senderName?: string) {
    const msg: MultiplayerChatMessageWithTimestamp = {
      id: this.generateId(),
      senderId: selfId,
      senderName: senderName || selfId.slice(0, 6), // Default name if not provided
      text,
      timestamp: Date.now(),
    };
    this.addMessage(msg); // add locally
    const [sendChatMessage] = room.makeAction<MultiplayerChatMessage>(MULTIPLAYER.EVENTS.CHAT_MESSAGE);
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
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}
