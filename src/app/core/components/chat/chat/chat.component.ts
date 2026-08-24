import { AfterViewInit, Component, ElementRef, Input, OnDestroy, ViewChild } from '@angular/core';
import { map, Observable, Subscription } from 'rxjs';
import { MultiplayerChatMessage, PlayerInfo } from 'src/app/core/models/multiplayer';
import { MultiplayerChatService, MultiplayerPlayerInfoService } from 'src/app/core/services/multiplayer';
import { KeyboardInsetService } from 'src/app/core/services/shared';
import { selfId } from 'trystero';

const MAX_VISIBLE_MESSAGES = 100;

@Component({
  selector: 'app-chat',
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.scss'],
  standalone: false
})
export class ChatComponent implements AfterViewInit, OnDestroy {

  messages$: Observable<MultiplayerChatMessage[]>;
  players: { [peerdId: string]: PlayerInfo | undefined } = {};
  selfId = selfId;

  /** Bound to the compose field. See the template for why this is not a template ref. */
  draft = '';

  @ViewChild('messageList') private messageList?: ElementRef<HTMLElement>;

  private subscriptions = new Subscription();

  constructor(
    private chatService: MultiplayerChatService,
    private userInfoService: MultiplayerPlayerInfoService,
    private keyboardInset: KeyboardInsetService,
  ) {
    // Limit observable to last 100 messages
    this.messages$ = this.chatService.getMessagesObservable().pipe(map(messages => messages.slice(-MAX_VISIBLE_MESSAGES)))
    this.subscriptions.add(
      this.userInfoService.playerList$.subscribe(players => this.updatePlayers(players))
    );
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

  ngAfterViewInit() {
    this.subscriptions.add(
      this.chatService.getMessagesObservable().subscribe(() => this.scrollToLatest())
    );
  }

  ngOnDestroy() {
    this.subscriptions.unsubscribe();
    this.keyboardInset.stop();
  }

  trackBy(_: number, message: MultiplayerChatMessage) {
    return message.id;
  }

  get canSend(): boolean {
    return this.draft.trim().length > 0;
  }

  /**
   * Send the composed message and clear the field.
   */
  send() {
    if (!this.canSend) return;
    this.chatService.sendMessage(this.draft);
    this.draft = '';
  }

  private scrollToLatest() {
    // Defer past the render of the message that triggered this.
    setTimeout(() => {
      const list = this.messageList?.nativeElement;
      if (list) list.scrollTop = list.scrollHeight;
    });
  }

  private updatePlayers(players: PlayerInfo[]) {
    // Do not remove players who have left,
    // so their names remain visible in the chat history for past messages
    players.forEach(player => {
      this.players[player.peerId] = player;
    })
  }
}
