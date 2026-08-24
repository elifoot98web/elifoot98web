import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { LoadingController } from '@ionic/angular';
import {
  GameState,
  CursorPositionMessage,
  CursorClickMessage,
  MultiplayerJoinErrorKind,
  MultiplayerJoinFailure
} from '../../core/models/multiplayer';
import { firstValueFrom, map, Observable, race, Subscription, timeout } from 'rxjs';
import {
  MultiplayerChatService,
  MultiplayerCursorService,
  MultiplayerService,
  MultiplayerStreamService,
  MultiplayerUiService
} from '../../core/services/multiplayer';
import { CursorRendererHelper } from 'src/app/core/helpers/cursor-renderer.helper';
import { OverlaySyncHelper } from 'src/app/core/helpers/overlay-sync.helper';
import { ChatPanelHelper } from 'src/app/core/helpers/chat-panel.helper';
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
    // Still in a room (a previous attempt, or a host that walked out)? Leave first.
    // The service serialises the teardown, so the rejoin no longer races it.
    if (this.multiplayerService.isInRoom) {
      this.resetRoomState();
    }

    this.joinError = '';
    const loading = await this.loadingController.create({
      message: this.multiplayerService.isDraining ? 'Encerrando a sala anterior...' : 'Entrando na sala...',
    });
    await loading.present();

    try {
      await this.multiplayerService.joinGameRoom(this.playerName, this.roomId, this.password, this.cursorColor);
      const stream = await this.awaitStream();
      this.attachStream(stream);
      this.subscribeToCursors();
    } catch (err: any) {
      await this.handleJoinFailure(err);
    } finally {
      await loading.dismiss();
    }
  }

  /**
   * Wait for the host's video, racing the wait against the failures trystero can
   * actually name. The timeout stays as the fallback: a room code nobody is hosting
   * produces no error at all, only silence.
   */
  private awaitStream(): Promise<MediaStream> {
    const failFast$ = this.multiplayerService.joinError$.pipe(
      map<MultiplayerJoinErrorKind, never>(kind => { throw new MultiplayerJoinFailure(kind); })
    );

    return firstValueFrom(
      race(this.multiplayerStreamService.videoStream$, failFast$).pipe(
        timeout({ first: MULTIPLAYER.STREAM_WAIT_TIMEOUT })
      )
    );
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
    const shouldOpen = typeof force === 'boolean' ? force : !this.isChatOpen;
    if (shouldOpen === this.isChatOpen) return;
    this.isChatOpen = shouldOpen;

    if (shouldOpen) {
      ChatPanelHelper.focusPanel();
    } else {
      // No emulator here, so focus goes back to the control that opened the drawer.
      ChatPanelHelper.focusToggle();
    }
  }

  /** Escape closes the drawer, scoped to the panel so nothing else reacts to it. */
  onChatEscape(event: Event) {
    event.stopPropagation();
    this.toggleChat(false);
  }

  /** Accessible name for both chat controls, including the unread count. */
  chatToggleLabel(unread: number | null): string {
    return ChatPanelHelper.toggleAriaLabel(this.isChatOpen, unread);
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
    this.joinError = this.describeJoinFailure(err);
    // Settle on ERROR so the page offers a retry instead of silently resetting.
    this.resetRoomState(GameState.ERROR);
    await this.multiplayerUiService.showError(this.joinError);
  }

  private describeJoinFailure(err: any): string {
    if (err instanceof MultiplayerJoinFailure) {
      switch (err.kind) {
        case 'wrong-password':
          return `Senha incorreta para a sala ${this.roomId}. Confirme a senha com o anfitrião.`;
        case 'connection-failed':
          return 'Não foi possível estabelecer a conexão direta com o anfitrião. ' +
            'Tente outra rede (Wi-Fi em vez de dados móveis) ou desative a VPN.';
      }
    }
    // rxjs `timeout` throws a TimeoutError. Silence is all we ever get for a room code
    // nobody is hosting, so this stays the catch-all.
    if (err?.name === 'TimeoutError') {
      return 'Não recebemos a transmissão. Verifique o código da sala e a senha, ' +
        'e confirme que o anfitrião já começou a hospedar.';
    }
    return err?.message || 'Erro ao entrar na sala.';
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

    // `loadedmetadata` delivers the first real intrinsic size; `resize` fires whenever the
    // received frame size changes afterwards.
    //
    // That is NOT the host toggling its chat: canvas.captureStream() follows the canvas
    // backing store, which js-dos pins to the DOS frame size, so the host's layout cannot
    // move it. Two things still can — a DOS/Windows video-mode change on the host, and
    // WebRTC encoder downscaling under bandwidth or CPU pressure. Only the first changes
    // the aspect ratio, and therefore the box the overlay is aligned to; a downscale is
    // proportional and is now a no-op for layout. Do not drop this listener: with the
    // container observer alone, a mid-session ratio change would leave the overlay sized to
    // the old box until the next window resize.
    video.addEventListener('loadedmetadata', this.syncStreamContainer);
    video.addEventListener('resize', this.syncStreamContainer);

    // Observe the video AND its container.
    //  - the video, because its CSS box now follows its intrinsic size (width/height auto
    //    under max-width/max-height: 100%), so a resolution change resizes it;
    //  - the container, because a container-only resize (window, rotation, the `ion-hide`
    //    flip) can leave the video's size untouched while MOVING it — it is centred, so
    //    offsetLeft/offsetTop change, and that is exactly what `align` reads.
    // Observing the video is only safe because this callback no longer writes the video's
    // dimensions: it writes the absolutely-positioned overlay's, which cannot feed back
    // into the video's layout. Double-firing per resize is harmless — the write is
    // idempotent. `detachStream()` already disconnects both targets in one call.
    //
    // Load-bearing for the FIRST alignment: setState(IN_ROOM) above has not rendered yet,
    // so the call below measures a container still inside the `ion-hide` subtree (0x0).
    // The observer re-runs it once the class flips, and repositionAll's zero guard makes
    // the 0x0 pass a no-op instead of collapsing every cursor into the corner.
    this.stopObservingOverlay = OverlaySyncHelper.observe(
      [video, video.parentElement],
      this.syncStreamContainer
    );
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

  /**
   * Re-align the cursor overlay with the video's visible box.
   *
   * Nothing here sizes the video: `#stream-target` letterboxes itself in CSS (see
   * join-game.page.scss), so its border box already equals the picture. The deleted
   * `scaleVideoToContainer()` did a read-then-write layout pass on every observer tick,
   * and its inline width/height survived `detachStream()` — so a rejoin briefly rendered
   * the previous room's px size on the reused element. There is no such state now.
   *
   * Mirror of `GamePage.syncOverlayWithGameCanvas()`.
   */
  private syncStreamContainer = () => {
    const video = this.getVideoElement();
    const overlay = this.getOverlayElement();
    if (!video || !overlay) return;
    OverlaySyncHelper.align(overlay, video);
    // Must run AFTER align: repositionAll reads the overlay's fresh offsetWidth/Height.
    CursorRendererHelper.repositionAll(overlay);
  };
}
