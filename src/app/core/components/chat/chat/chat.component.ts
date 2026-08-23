import { AfterViewInit, Component, ElementRef, Input, OnDestroy, ViewChild } from '@angular/core';
import { map, Observable, Subscription } from 'rxjs';
import { MultiplayerChatMessage, PlayerInfo } from 'src/app/core/models/multiplayer';
import { MultiplayerChatService, MultiplayerPlayerInfoService } from 'src/app/core/services/multiplayer';
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

  @ViewChild('messageList') private messageList?: ElementRef<HTMLElement>;

  private subscriptions = new Subscription();

  constructor(
    private chatService: MultiplayerChatService,
    private userInfoService: MultiplayerPlayerInfoService,
  ) {
    // Limit observable to last 100 messages
    this.messages$ = this.chatService.getMessagesObservable().pipe(map(messages => messages.slice(-MAX_VISIBLE_MESSAGES)))
    this.subscriptions.add(
      this.userInfoService.playerList$.subscribe(players => this.updatePlayers(players))
    );
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
  }

  trackBy(_: number, message: MultiplayerChatMessage) {
    return message.id;
  }

  /**
   * Send a chat message
   */
  sendMessage(text: string) {
    this.chatService.sendMessage(text);
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
