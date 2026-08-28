import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Room, selfId } from 'trystero';
import { MultiplayerChatMessage, TypingMessage } from '../../models/multiplayer';
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

  // Typing state. Held as peerId -> expiry so a peer that goes silent (or drops) stops
  // showing as typing without needing a "stopped" message that may never arrive.
  private typingUntil = new Map<string, number>();
  private typingSubject = new BehaviorSubject<string[]>([]);
  private typingSweep?: ReturnType<typeof setInterval>;
  private lastTypingSentAt = 0;
  private typingAction?: { send: (data: TypingMessage) => Promise<void> };

  /** Peer ids currently composing. */
  typingPeers$ = this.typingSubject.asObservable();

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
      // Their message arrived, so whatever they were typing is now sent.
      this.clearTyping(peerId);
    };

    const typing = room.makeAction<TypingMessage>(MULTIPLAYER.EVENTS.TYPING);
    this.typingAction = typing;
    typing.onMessage = (_data, { peerId }) => {
      this.typingUntil.set(peerId, Date.now() + MULTIPLAYER.TYPING_EXPIRY_MS);
      this.publishTyping();
    };

    // A sweep rather than a timer per peer: expiries are all the same length, and one
    // interval cannot leak a handle per typist.
    this.typingSweep = setInterval(() => this.expireTyping(), MULTIPLAYER.TYPING_SEND_THROTTLE_MS);
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
   *
   * @param timestamp when the event happened, for callers that add the line later than that.
   *   The transcript is timestamp-ordered, so a deferred join line stamped on flush would
   *   sort after the first message of a guest who greets the room within the delay.
   */
  addSystemMessage(text: string, timestamp = Date.now()) {
    const wasRead = this.readMessageCount === this.messages.length;

    this.addMessage({
      id: this.generateId(),
      senderId: '',
      text,
      timestamp,
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
   * Tell peers we are composing. Throttled, and deliberately fire-and-forget: a dropped
   * ping just means the indicator expires a little early, which is the harmless direction.
   */
  notifyTyping() {
    if (!this.typingAction) return;

    const now = Date.now();
    if (now - this.lastTypingSentAt < MULTIPLAYER.TYPING_SEND_THROTTLE_MS) return;
    this.lastTypingSentAt = now;

    this.typingAction.send({}).catch(err => console.warn('Typing ping failed', err));
  }

  private clearTyping(peerId: string) {
    if (this.typingUntil.delete(peerId)) this.publishTyping();
  }

  private expireTyping() {
    const now = Date.now();
    let changed = false;
    for (const [peerId, expiry] of this.typingUntil) {
      if (expiry <= now) {
        this.typingUntil.delete(peerId);
        changed = true;
      }
    }
    if (changed) this.publishTyping();
  }

  private publishTyping() {
    this.typingSubject.next([...this.typingUntil.keys()]);
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

    clearInterval(this.typingSweep);
    this.typingSweep = undefined;
    this.typingAction = undefined;
    this.lastTypingSentAt = 0;
    this.typingUntil.clear();
    this.typingSubject.next([]);
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
