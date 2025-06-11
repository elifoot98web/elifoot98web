import { Component, OnDestroy } from '@angular/core';
import { map, Observable, Subscription } from 'rxjs';
import { MultiplayerChatMessageWithTimestamp, PlayerInfo } from 'src/app/core/models/multiplayer';
import { MultiplayerChatService, MultiplayerPlayerInfoService } from 'src/app/core/services/multiplayer';
import { selfId } from 'trystero';

@Component({
  selector: 'app-chat',
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.scss'],
  standalone: false
})
export class ChatComponent implements OnDestroy {

  messages$: Observable<MultiplayerChatMessageWithTimestamp[]>;
  players: { [peerdId: string]: PlayerInfo | undefined } = {};
  selfId = selfId;
  private playersSubscription?: Subscription

  constructor(
    private chatService: MultiplayerChatService,
    private userInfoService: MultiplayerPlayerInfoService,
  ) {
    // Limit observable to last 100 messages
    this.messages$ = this.chatService.getMessagesObservable().pipe(map(messages => messages.slice(-100)))
    this.playersSubscription = this.userInfoService.playerList$.subscribe(players => {
      this.updatePlayers(players)
    })
  }

  ngOnDestroy() {
    this.playersSubscription?.unsubscribe();
  }

  trackBy(_: number, message: MultiplayerChatMessageWithTimestamp) {
    return message.id;
  }

  /**
   * Send a chat message
   */
  sendMessage(text: string) {
    this.chatService.sendMessage(text);
  }

  private updatePlayers(players: PlayerInfo[]) {
    // Do not remove players who have left, 
    // so their names remain visible in the chat history for past messages
    players.forEach(player => {
      this.players[player.peerId] = player;
    })
  }

  
}
