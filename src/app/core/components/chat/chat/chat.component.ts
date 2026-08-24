import { AfterViewInit, Component, ElementRef, Input, OnDestroy, ViewChild } from '@angular/core';
import { combineLatest, map, Observable, Subscription } from 'rxjs';
import { MultiplayerChatMessage, PlayerInfo } from 'src/app/core/models/multiplayer';
import { MultiplayerChatService, MultiplayerPlayerInfoService } from 'src/app/core/services/multiplayer';
import { KeyboardInsetService } from 'src/app/core/services/shared';
import { ColorHelper } from 'src/app/core/helpers/color.helper';
import { selfId } from 'trystero';

const MAX_VISIBLE_MESSAGES = 100;

/**
 * One rendered line. MSN grouped consecutive messages from the same sender under a single
 * "Fulano diz:" header, which is both authentic and much denser than a bubble per message
 * — the whole point on a phone.
 */
interface ChatLine {
  id: string;
  text: string;
  timestamp: number;
  kind: 'user' | 'system';
  isSelf: boolean;
  /** Rendered only on the first message of a run. */
  showHeader: boolean;
  senderName: string;
  /** Precomputed here, never in the template: see ColorHelper.darkenForText. */
  senderColor: string;
}

@Component({
  selector: 'app-chat',
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.scss'],
  standalone: false
})
export class ChatComponent implements AfterViewInit, OnDestroy {

  lines$: Observable<ChatLine[]>;
  /** Everyone currently in the room, including us. */
  participantCount$: Observable<number>;

  /** Bound to the compose field. See the template for why this is not a template ref. */
  draft = '';

  /** Shown in the titlebar. Set by the page that hosts the panel. */
  @Input() roomCode = '';

  @ViewChild('messageList') private messageList?: ElementRef<HTMLElement>;

  private subscriptions = new Subscription();

  constructor(
    private chatService: MultiplayerChatService,
    private userInfoService: MultiplayerPlayerInfoService,
    private keyboardInset: KeyboardInsetService,
  ) {
    // The view model is built once per emission, off the change-detection path: grouping,
    // name resolution and colour darkening all happen here rather than in the template.
    this.lines$ = combineLatest([
      this.chatService.getMessagesObservable(),
      this.userInfoService.playerList$,
    ]).pipe(
      map(([messages, players]) => this.toLines(messages.slice(-MAX_VISIBLE_MESSAGES), players))
    );

    // Derived from the live roster, NOT from a sticky local map: names are kept around
    // for history so old messages stay attributed, but counting them would include people
    // who have already left.
    this.participantCount$ = this.userInfoService.playerList$.pipe(map(players => players.length));

    // This component is the only consumer of --kb-inset and it exists exactly as long as a
    // chat panel is mounted (host: gated on isStreaming; guest: page lifetime), so it owns
    // the service's lifecycle. providedIn:'root' is lazy, so something must.
    this.keyboardInset.start();
  }

  /**
   * Whether the sidebar holding this component is open. Drives both the unread count
   * (tracked in the chat service, since the badge is rendered outside this component)
   * and scrolling to the newest message on reveal.
   */
  @Input() set visible(isVisible: boolean) {
    this.chatService.setChatVisible(isVisible);
    if (isVisible) this.scrollToLatest();
  }

  get canSend(): boolean {
    return this.draft.trim().length > 0;
  }

  ngAfterViewInit() {
    this.subscriptions.add(
      this.chatService.getMessagesObservable().subscribe(() => this.scrollToLatest())
    );
  }

  ngOnDestroy() {
    this.subscriptions.unsubscribe();
    this.keyboardInset.stop();
  }

  trackBy(_: number, line: ChatLine) {
    return line.id;
  }

  /**
   * Send the composed message and clear the field.
   */
  send() {
    if (!this.canSend) return;
    this.chatService.sendMessage(this.draft);
    this.draft = '';
  }

  /**
   * Group consecutive messages by sender and resolve each sender's display name and
   * text colour.
   *
   * Names are looked up per render rather than cached on the message, so a peer that
   * identifies itself after its first message still gets attributed correctly.
   */
  private toLines(messages: MultiplayerChatMessage[], players: PlayerInfo[]): ChatLine[] {
    const byPeer = new Map(players.map(p => [p.peerId, p]));
    let previousSender: string | null = null;

    return messages.map(msg => {
      const isSystem = msg.kind === 'system';
      const isSelf = msg.senderId === selfId;
      const player = byPeer.get(msg.senderId);
      // A system line never carries a sender, and must not merge into the run around it.
      const showHeader = !isSystem && msg.senderId !== previousSender;
      previousSender = isSystem ? null : msg.senderId;

      return {
        id: msg.id,
        text: msg.text,
        timestamp: msg.timestamp,
        kind: isSystem ? 'system' : 'user',
        isSelf,
        showHeader,
        senderName: isSelf ? 'Você' : (player?.playerName?.trim() || msg.senderId.slice(0, 6)),
        senderColor: ColorHelper.darkenForText(player?.playerColor || '#000000'),
      } as ChatLine;
    });
  }

  private scrollToLatest() {
    // Defer past the render of the message that triggered this.
    setTimeout(() => {
      const list = this.messageList?.nativeElement;
      if (list) list.scrollTop = list.scrollHeight;
    });
  }
}
