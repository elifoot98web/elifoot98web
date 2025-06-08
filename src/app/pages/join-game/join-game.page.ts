import { Component, AfterViewInit, OnDestroy } from '@angular/core';
import { AlertController, LoadingController } from '@ionic/angular';
import { GameState, CursorPositionMessage, CursorClickMessage } from '../../core/models/multiplayer';
import { Subscription } from 'rxjs';
import { MultiplayerCursorService, MultiplayerService, MultiplayerStreamService } from '../../core/services/multiplayer';
import { CursorRendererHelper } from 'src/app/core/helpers/cursor-renderer.helper';
import { MULTIPLAYER } from 'src/app/core/models/constants';

@Component({
  selector: 'app-join-game',
  templateUrl: './join-game.page.html',
  styleUrls: ['./join-game.page.scss'],
  standalone: false,
})
export class JoinGamePage implements AfterViewInit, OnDestroy {
  private playerName = '';
  private roomId = '';
  private password = '';
  private cursorColor = MULTIPLAYER.DEFAULT_CURSOR_COLOR; // Default cursor color

  GameState = GameState;
  joinError = '';

  gameState: GameState = GameState.NOT_IN_ROOM;

  private cursorSubscription?: Subscription;

  constructor(
    private loadingController: LoadingController,
    private alertController: AlertController,
    private multiplayerService: MultiplayerService,
    private multiplayerCursorService: MultiplayerCursorService,
    private multiplayerStreamService: MultiplayerStreamService
  ) { }

  ngAfterViewInit() {
    this.syncOverlayWithVideo();
    window.addEventListener('resize', () => this.syncOverlayWithVideo());
  }

  ngOnDestroy() {
    this.cursorSubscription?.unsubscribe();
  }

  /**
   * Prompt user for name, room id, and password, then join the game room.
   */
  async promptJoinInfo() {
    const alert = await this.alertController.create({
      header: 'Entrar em sala multiplayer',
      inputs: [
        { name: 'playerName', type: 'text', placeholder: 'Seu nome', value: this.playerName },
        { name: 'roomId', type: 'text', placeholder: 'ID da sala', value: this.roomId },
        { name: 'password', type: 'text', placeholder: 'Senha da Sala (opcional)', value: this.password },
      ],
      buttons: [
        {
          text: 'Cancelar',
          role: 'cancel',
        },
        {
          text: 'Entrar',
          handler: async (data) => {
            this.playerName = data.playerName;
            this.roomId = data.roomId;
            this.password = data.password;
            await this.joinRoom();
          }
        }
      ]
    });
    await alert.present();
  }

  async joinRoom() {
    this.gameState = GameState.JOINING_ROOM;
    this.joinError = '';
    const loading = await this.loadingController.create({ message: 'Entrando na sala...' });
    await loading.present();
    try {
      await this.multiplayerService.joinGameRoom(this.playerName, this.roomId, this.password);      
      // handler stream 
      const stream$ = this.multiplayerStreamService.getStreamObservable().subscribe((stream) => {
        this.gameState = GameState.IN_ROOM;
        const video = document.querySelector('#stream-target') as HTMLVideoElement
        if (!video) { 
          stream$.unsubscribe();
          throw new Error('Video element not found') 
        }
        video.srcObject = stream;
      })

      // handle cursors
      // Subscribe to cursor position updates
      this.cursorSubscription = this.multiplayerCursorService.getCursorsObservable().subscribe(cursors => {
        this.renderCursors(cursors);
      });

      // Subscribe to cursor click events
      this.multiplayerCursorService.getClickObservable().subscribe(click => {
        if (click) {
          this.renderClick(click);
        }
      });
      
    } catch (err: any) {
      this.joinError = err.message || 'Erro ao entrar na sala.';
      this.gameState = GameState.ERROR;
      await this.showError(this.joinError);
      await this.promptJoinInfo();
    } finally {
      await loading.dismiss();
    }
  }
  
  /**
   * Handle pointer (mouse/touch) move and send to cursorService.
  */
 onPointerMove(event: MouseEvent | TouchEvent) {
    const { x, y } = this.processCursorEvent(event);
    const cursorMessage: CursorPositionMessage = {
      x: x,
      y: y,
      color: this.cursorColor,
      name: this.playerName
    };
    this.multiplayerCursorService.sendLocalCursor(cursorMessage)
  }

  onClick(event: MouseEvent | TouchEvent) {
    const { x, y } = this.processCursorEvent(event);
    const clickMessage: CursorClickMessage = {
      x: x,
      y: y,
      color: this.cursorColor
    }
    this.multiplayerCursorService.sendLocalClick(clickMessage);
  }

  showParticipants() {
    throw new Error('Not implemented yet');
  }
  
  private async showError(message: string) {
    const alert = await this.alertController.create({
      header: 'Erro',
      message,
      buttons: ['OK']
    });
    await alert.present();
  }

  private processCursorEvent(event: MouseEvent | TouchEvent): { x: number, y: number } {
    let x = 0, y = 0;
    if (event instanceof MouseEvent) {
     // we need to transform the mouse coordinates to the target element where 0,0 is the top left and 1,1 is the bottom right
     x = event.offsetX / (event.target as HTMLElement).clientWidth;
     y = event.offsetY / (event.target as HTMLElement).clientHeight;
     
    } else if (event instanceof TouchEvent && event.touches.length > 0) {
      // TODO: validate if coordinates match the same values of event.offsetX/Y
      // when using touch events, we need to calculate the position relative to the target element
      const rect = (event.target as HTMLElement).getBoundingClientRect();
      x = (event.touches[0].clientX - rect.left) / rect.width;
      y = (event.touches[0].clientY - rect.top) / rect.height;
    }
    return { x, y };
  }

  private renderCursors(cursors: { [peerId: string]: CursorPositionMessage }) {
    const canvas = document.querySelector('#cursors-overlay') as HTMLElement;
    if (!canvas) return;
    this.syncOverlayWithVideo();

    CursorRendererHelper.renderCursors(canvas, cursors);
  }

  private renderClick(click: CursorClickMessage) {
    const canvas = document.querySelector('#cursors-overlay') as HTMLElement;
    if (!canvas) return;
    this.syncOverlayWithVideo();

    CursorRendererHelper.renderClick(canvas, click);
  }

  private syncOverlayWithVideo() {
    const video = document.querySelector('#stream-target') as HTMLVideoElement;
    const overlay = document.querySelector('#cursors-overlay') as HTMLElement;
    if (video && overlay) {
      overlay.style.position = 'absolute';
      overlay.style.pointerEvents = 'none';
      overlay.style.left = video.offsetLeft + 'px';
      overlay.style.top = video.offsetTop + 'px';
      overlay.style.width = video.offsetWidth + 'px';
      overlay.style.height = video.offsetHeight + 'px';
    }
  }
}
