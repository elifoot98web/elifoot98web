import { Component, AfterViewInit, OnDestroy } from '@angular/core';
import { AlertController, LoadingController } from '@ionic/angular';
import { GuestGameState, PlayerCursorMessage } from '../../core/models/multiplayer';
import { Subscription } from 'rxjs';
import { MultiplayerCursorService, MultiplayerGuestService } from '../../core/services/multiplayer';
import { CursorRendererHelper } from 'src/app/core/helpers/cursor-renderer.helper';

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
  private cursorColor = '#aa00aa'; // Default cursor color

  GuestGameState = GuestGameState;
  joinError = '';

  gameState: GuestGameState = GuestGameState.NOT_IN_ROOM;

  hostStream?: MediaStream;

  private cursorSubscription?: Subscription;

  constructor(
    private loadingController: LoadingController,
    private alertController: AlertController,
    private multiplayerGuestService: MultiplayerGuestService,
    private multiplayerCursorService: MultiplayerCursorService
  ) { }

  ngAfterViewInit() {
    this.syncOverlayWithVideo();
    window.addEventListener('resize', () => this.syncOverlayWithVideo());
    // Subscribe to cursor updates
    this.cursorSubscription = this.multiplayerCursorService.getCursorsObservable().subscribe(cursors => {
      this.renderCursors(cursors);
    });
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
    this.gameState = GuestGameState.JOINING_ROOM;
    this.joinError = '';
    const loading = await this.loadingController.create({ message: 'Entrando na sala...' });
    await loading.present();
    try {
      await this.multiplayerGuestService.joinGameRoom(this.playerName, this.roomId, this.password);
      this.multiplayerGuestService.onHostStream((stream) => {
        this.hostStream = stream;
        const video = document.querySelector('#stream-target') as HTMLVideoElement
        if (!video) throw new Error('Video element not found')
        video.srcObject = stream;
        this.gameState = GuestGameState.IN_ROOM;
        // Optionally, subscribe to player list or other events here
      })
    } catch (err: any) {
      this.joinError = err.message || 'Erro ao entrar na sala.';
      this.gameState = GuestGameState.ERROR;
      await this.showError(this.joinError);
      await this.promptJoinInfo();
    } finally {
      await loading.dismiss();
    }
  }

  showParticipants() {
    const participants = this.multiplayerGuestService.playerList;
  }

  async showError(message: string) {
    const alert = await this.alertController.create({
      header: 'Erro',
      message,
      buttons: ['OK']
    });
    await alert.present();
  }

  /**
   * Handle pointer (mouse/touch) move and send to cursorService.
   */
  onPointerMove(event: MouseEvent | TouchEvent) {
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
    this.multiplayerGuestService.sendPlayerPointer({ x, y, color: this.cursorColor, name: this.playerName });
  }

  private renderCursors(cursors: { [peerId: string]: PlayerCursorMessage }) {
    const canvas = document.querySelector('#cursors-overlay') as HTMLElement;
    if (!canvas) return;
    this.syncOverlayWithVideo();

    CursorRendererHelper.renderCursors(canvas, cursors);
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
