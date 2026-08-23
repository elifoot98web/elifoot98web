import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { LoadingController } from '@ionic/angular';
import { GameState, CursorPositionMessage, CursorClickMessage } from '../../core/models/multiplayer';
import { Observable, Subscription } from 'rxjs';
import {
  MultiplayerChatService,
  MultiplayerCursorService,
  MultiplayerService,
  MultiplayerStreamService,
  MultiplayerUiService
} from '../../core/services/multiplayer';
import { CursorRendererHelper } from 'src/app/core/helpers/cursor-renderer.helper';
import { OverlaySyncHelper } from 'src/app/core/helpers/overlay-sync.helper';
import { MULTIPLAYER } from 'src/app/core/models/constants';

@Component({
  selector: 'app-join-game',
  templateUrl: './join-game.page.html',
  styleUrls: ['./join-game.page.scss'],
  standalone: false,
})
export class JoinGamePage implements OnInit, OnDestroy {
  private playerName = '';
  private roomId = '';
  private password = '';
  private cursorColor = MULTIPLAYER.DEFAULT_CURSOR_COLOR;

  GameState = GameState;
  joinError = '';

  gameState: GameState = GameState.NOT_IN_ROOM;

  isChatOpen = false;

  /** Drives the badge on the chat toggle, which sits outside the chat component. */
  unreadCount$: Observable<number>;

  /** Lives as long as the page. */
  private pageSubscriptions = new Subscription();
  /** Recreated per room, so a rejoin does not stack duplicate cursor subscriptions. */
  private roomSubscriptions = new Subscription();
  private stopObservingOverlay?: () => void;

  constructor(
    private loadingController: LoadingController,
    private route: ActivatedRoute,
    private multiplayerService: MultiplayerService,
    private multiplayerCursorService: MultiplayerCursorService,
    private multiplayerStreamService: MultiplayerStreamService,
    private multiplayerUiService: MultiplayerUiService,
    chatService: MultiplayerChatService
  ) {
    this.unreadCount$ = chatService.unreadCount$;
  }

  ngOnInit() {
    this.pageSubscriptions.add(
      this.multiplayerService.gameStateSubject.subscribe(state => this.onGameStateChange(state))
    );

    // Arriving via a share link should feel like following a link, so open the join
    // form straight away with the code already filled in.
    if (this.route.snapshot.queryParamMap.get('room')) {
      this.promptJoinInfo();
    }
  }

  ngOnDestroy() {
    this.detachStream();
    this.roomSubscriptions.unsubscribe();
    this.pageSubscriptions.unsubscribe();
    // Leaving here matters: without it the peer connection, ping interval and
    // received stream all survive navigation back to the landing page.
    this.multiplayerService.leaveRoom();
  }

  /**
   * Collect name, room code and colour, then join. A room code from a share link is
   * prefilled so the guest only needs to fill in who they are.
   */
  async promptJoinInfo() {
    // Once the guest has typed a code of their own it wins over the one in the URL,
    // otherwise retrying with a different room would be impossible.
    const presetRoomCode = this.roomId || (this.route.snapshot.queryParamMap.get('room') ?? '');
    const setup = await this.multiplayerUiService.promptRoomSetup('guest', presetRoomCode);
    if (!setup) return;

    this.playerName = setup.playerName;
    this.roomId = setup.roomCode;
    this.password = setup.password;
    this.cursorColor = setup.playerColor;

    await this.joinRoom();
  }

  async joinRoom() {
    // A previous attempt, or a host that walked out, can leave us still in a room.
    if (this.multiplayerService.isInRoom) {
      this.resetRoomState();
    }

    this.joinError = '';
    const loading = await this.loadingController.create({ message: 'Entrando na sala...' });
    await loading.present();

    try {
      await this.multiplayerService.joinGameRoom(this.playerName, this.roomId, this.password, this.cursorColor);

      // Trystero connects to a room name, not to a host: a wrong code or password looks
      // identical to an empty room, so the only failure signal is the stream never arriving.
      const stream = await this.multiplayerStreamService.waitForVideoStream();
      this.attachStream(stream);
      this.subscribeToCursors();
    } catch (err: any) {
      await this.handleJoinFailure(err);
    } finally {
      await loading.dismiss();
    }
  }

  async leaveRoom() {
    const confirmed = await this.multiplayerUiService.confirmLeave('Você vai parar de assistir a esta partida.');
    if (!confirmed) return;
    this.resetRoomState();
  }

  async showParticipants() {
    await this.multiplayerUiService.showParticipants();
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

  toggleChat(force?: boolean) {
    this.isChatOpen = typeof force === 'boolean' ? force : !this.isChatOpen;
  }

  private onGameStateChange(state: GameState) {
    this.gameState = state;
    if (state === GameState.HOST_LEFT) {
      this.joinError = 'O anfitrião saiu da sala. A transmissão foi encerrada.';
      // Nothing left to spectate, so drop the room — but keep HOST_LEFT on screen
      // rather than falling back to the idle card.
      this.detachStream();
      this.roomSubscriptions.unsubscribe();
      this.roomSubscriptions = new Subscription();
      this.multiplayerService.leaveRoom(GameState.HOST_LEFT);
    }
  }

  private async handleJoinFailure(err: any) {
    // rxjs `timeout` throws a TimeoutError; anything else is a genuine connection fault.
    const isTimeout = err?.name === 'TimeoutError';
    this.joinError = isTimeout
      ? 'Não recebemos a transmissão. Verifique o código da sala e a senha, e confirme que o anfitrião já começou a hospedar.'
      : err?.message || 'Erro ao entrar na sala.';

    // Settle on ERROR so the page offers a retry instead of silently resetting.
    this.resetRoomState(GameState.ERROR);
    await this.multiplayerUiService.showError(this.joinError);
  }

  private resetRoomState(nextState: GameState = GameState.NOT_IN_ROOM) {
    this.detachStream();
    this.roomSubscriptions.unsubscribe();
    this.roomSubscriptions = new Subscription();
    this.isChatOpen = false;
    this.multiplayerService.leaveRoom(nextState);
  }

  /**
   * Tear down everything attached to the current video element, so a later rejoin does
   * not stack duplicate listeners or observers on it.
   */
  private detachStream() {
    this.stopObservingOverlay?.();
    this.stopObservingOverlay = undefined;

    const video = this.getVideoElement();
    if (!video) return;
    video.removeEventListener('loadedmetadata', this.syncStreamContainer);
    video.removeEventListener('resize', this.syncStreamContainer);
    video.srcObject = null;
  }

  private attachStream(stream: MediaStream) {
    const video = this.getVideoElement();
    if (!video) throw new Error('Video element not found');

    video.srcObject = stream;
    this.multiplayerService.setState(GameState.IN_ROOM);

    // The host re-scales its canvas whenever its own chat sidebar is toggled, which
    // changes this track's resolution mid-call.
    video.addEventListener('loadedmetadata', this.syncStreamContainer);
    video.addEventListener('resize', this.syncStreamContainer);

    // Observing the container, not the video: syncStreamContainer sets the video's own
    // dimensions, so observing it would re-trigger on its own output.
    this.stopObservingOverlay = OverlaySyncHelper.observe([video.parentElement], this.syncStreamContainer);
    this.syncStreamContainer();
  }

  private subscribeToCursors() {
    this.roomSubscriptions.add(
      this.multiplayerCursorService.getCursorsObservable().subscribe(cursors => {
        this.renderCursors(cursors);
      })
    );

    this.roomSubscriptions.add(
      this.multiplayerCursorService.getClickObservable().subscribe(click => {
        if (click) this.renderClick(click);
      })
    );
  }

  private processCursorEvent(event: MouseEvent | TouchEvent): { x: number, y: number } {
    let x = 0, y = 0;
    if (event instanceof MouseEvent) {
     // we need to transform the mouse coordinates to the target element where 0,0 is the top left and 1,1 is the bottom right
     x = event.offsetX / (event.target as HTMLElement).clientWidth;
     y = event.offsetY / (event.target as HTMLElement).clientHeight;

    } else if (event instanceof TouchEvent && event.touches.length > 0) {
      // Touch events carry no offsetX/Y, so derive the same normalized coordinates
      // from the touch point relative to the target's bounding box.
      const rect = (event.target as HTMLElement).getBoundingClientRect();
      x = (event.touches[0].clientX - rect.left) / rect.width;
      y = (event.touches[0].clientY - rect.top) / rect.height;
    }
    return { x, y };
  }

  private renderCursors(cursors: { [peerId: string]: CursorPositionMessage }) {
    const overlay = this.getOverlayElement();
    if (!overlay) return;
    CursorRendererHelper.renderCursors(overlay, cursors);
  }

  private renderClick(click: CursorClickMessage) {
    const overlay = this.getOverlayElement();
    if (!overlay) return;
    CursorRendererHelper.renderClick(overlay, click);
  }

  private getVideoElement(): HTMLVideoElement | null {
    return document.querySelector('#stream-target');
  }

  private getOverlayElement(): HTMLElement | null {
    return document.querySelector('#cursors-overlay');
  }

  private syncStreamContainer = () => {
    this.scaleVideoToContainer();

    const video = this.getVideoElement();
    const overlay = this.getOverlayElement();
    if (video && overlay) {
      OverlaySyncHelper.align(overlay, video);
    }
  };

  private scaleVideoToContainer() {
    const video = this.getVideoElement();
    const container = video?.parentElement as HTMLElement;
    if (!video || !container || !video.videoWidth || !video.videoHeight) return;
    const containerW = container.clientWidth;
    const containerH = container.clientHeight;
    const videoAR = video.videoWidth / video.videoHeight;
    const containerAR = containerW / containerH;
    let width, height;
    if (containerAR > videoAR) {
      // Container is wider than video: fit by height
      height = containerH;
      width = height * videoAR;
    } else {
      // Container is taller than video: fit by width
      width = containerW;
      height = width / videoAR;
    }
    video.style.width = width + 'px';
    video.style.height = height + 'px';
    video.style.objectFit = 'unset'; // Remove object-fit so our sizing works
  }
}
