import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { LoadingController } from '@ionic/angular';
import {
  GameState,
  CursorPositionMessage,
  CursorClickMessage,
  MultiplayerJoinErrorKind,
  MultiplayerJoinFailure,
  MultiplayerUserRole
} from '../../core/models/multiplayer';
import { firstValueFrom, map, Observable, race, Subscription, timeout } from 'rxjs';
import {
  MultiplayerChatService,
  MultiplayerCursorService,
  MultiplayerIdentityService,
  MultiplayerPlayerInfoService,
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

  /** True only inside the host grace period, while the last frame is still on screen. */
  isReconnecting = false;

  /**
   * Whether the video surface should be on screen. A reconnect keeps it there: the whole
   * point of the grace period is that the last frame survives the blip.
   */
  get isSpectating(): boolean {
    return this.gameState === GameState.IN_ROOM || this.gameState === GameState.HOST_RECONNECTING;
  }

  /** Drives the badge on the chat toggle, which sits outside the chat component. */
  unreadCount$: Observable<number>;

  /**
   * Whose game this is. Read from the roster rather than from any claim, so it names the
   * peer that actually delivered the stream; empty until that peer's ident arrives.
   */
  hostName$: Observable<string>;

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
    private identityService: MultiplayerIdentityService,
    playerInfoService: MultiplayerPlayerInfoService,
    chatService: MultiplayerChatService
  ) {
    this.unreadCount$ = chatService.unreadCount$;
    this.hostName$ = playerInfoService.playerList$.pipe(
      map(players => players.find(player => player.role === MultiplayerUserRole.HOST)),
      map(host => host ? (host.playerName?.trim() || host.peerId.slice(0, 6)) : '')
    );
  }

  /** Whether this room needed a password, so the pill can show the lock. */
  get isRoomLocked(): boolean {
    return this.password.length > 0;
  }

  ngOnInit() {
    this.pageSubscriptions.add(
      this.multiplayerService.gameStateSubject.subscribe(state => this.onGameStateChange(state))
    );

    // Page-lifetime, and the ONLY place the stream is attached. `awaitStream()` used to do
    // it from a one-shot firstValueFrom, which meant that after the first attach nothing
    // was subscribed here at all: a host that re-added its stream emitted into a subject
    // with no listener and the guest went on showing a dead MediaStream — the frozen frame
    // a reconnect used to leave behind. Every emission now detaches and reattaches, so the
    // recovered picture is live.
    this.pageSubscriptions.add(
      this.multiplayerStreamService.videoStream$.subscribe(stream => {
        this.detachStream();
        this.attachStream(stream);
      })
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

  /**
   * Rejoin the room we just lost, without re-entering anything.
   *
   * The grace period only recovers a link trystero re-establishes by itself. When the drop is
   * on our side it does not, and the room stays perfectly alive for everyone else — so the
   * useful thing is a retry with the credentials we still hold in memory, rather than sending
   * the guest back to the code field for a room they never really left.
   */
  get canRetryLastRoom(): boolean {
    return this.roomId.length > 0 && this.playerName.length > 0;
  }

  async retryLastRoom() {
    if (!this.canRetryLastRoom) {
      await this.promptJoinInfo();
      return;
    }
    await this.joinRoom();
  }

  /**
   * Retry after a join that *failed*, from a clean page load.
   *
   * A rejected handshake — a wrong password being the ordinary way to get one — leaves
   * trystero reusing a dead connection, so retrying in place cannot work: measured, two
   * further attempts with the *correct* password both sat out the 20 s stream timeout, while
   * a reload joined first time. Retrying in place showed `Não recebemos a transmissão`, which
   * sends the guest back to check a password that is already right.
   */
  retryAfterFailure() {
    this.reloadSpectator(this.roomId);
  }

  /**
   * Reload the page as a spectator who has not joined anything yet, optionally with a room
   * code preset so the dialog comes back filled in.
   *
   * Every route back into a room goes through here, and it is a reload rather than an
   * in-page rejoin for one reason: trystero keeps one connection per peer in a module-level
   * registry that outlives any room and only lapses after ~2 minutes idle, and it does not
   * renegotiate media onto a connection that is already up. `pc.onnegotiationneeded` fires on
   * the host and the offer never lands, so a spectator who rejoins within the same page load
   * gets the data channel — ident, host announce, roster, chat, headcount, all correct and
   * instant — and no video at all, then times out. A fresh load means a fresh `selfId`, a
   * fresh handshake, and the host's track in the initial SDP.
   *
   * The cost is nil where it applies: a spectator has no emulator and no save state, the code
   * travels on the URL and the name comes back from storage. Contrast the host page, where
   * reloading would throw away the running game — which is why nothing here reloads while a
   * guest is actually watching.
   */
  private reloadSpectator(presetRoomCode?: string) {
    window.location.hash = presetRoomCode
      ? `#/join-game?room=${encodeURIComponent(presetRoomCode)}`
      : '#/join-game';
    // Changing only the hash does not reload, hence both statements.
    window.location.reload();
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
      // Awaited for its timeout and fail-fast behaviour only; the subscription in ngOnInit
      // is what attaches, and has already done so by the time this resolves.
      await this.awaitStream();
      this.subscribeToCursors();
      // Only after the stream actually arrived: a code that never produced a picture is not
      // a room worth offering again.
      await this.identityService.rememberRoom(this.roomId);
    } catch (err: any) {
      this.handleJoinFailure(err);
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

  /** The chat titlebar shows which room you are watching. */
  get currentRoomCode(): string {
    return this.roomId;
  }

  async leaveRoom() {
    const confirmed = await this.multiplayerUiService.confirmLeave('Você vai parar de assistir a esta partida.');
    if (!confirmed) return;
    // Tell the room first, so the host's roster and transcript update at once rather than
    // waiting for the unload to be noticed, then come back on a clean page: the next join
    // has to be a new peer to receive any video. See reloadSpectator().
    this.resetRoomState();
    this.reloadSpectator();
  }

  /** Same room window the host gets, minus the ability to end anything for anyone else. */
  async openMultiplayerPanel() {
    const action = await this.multiplayerUiService.showMultiplayerPanel(
      'guest', this.roomId, this.isRoomLocked
    );

    switch (action) {
      case 'copy':
        await this.multiplayerUiService.copyRoomLink(this.roomId);
        break;
      case 'share':
        await this.multiplayerUiService.shareRoom(this.roomId);
        break;
      case 'leave':
        await this.leaveRoom();
        break;
      case 'close':
        break;
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
    // Drives the scrim from a plain field rather than from the shared subject in the
    // template. The stream block and the cursor overlay have to stay mounted through a
    // reconnect — gating any of that DOM on the room state is exactly what would throw the
    // last frame away.
    this.isReconnecting = state === GameState.HOST_RECONNECTING;

    if (state === GameState.HOST_LEFT) {
      // Deliberately does NOT say the host left. `onPeerLeave(hostPeerId)` fires when OUR link
      // to the host drops, which is indistinguishable from the host actually leaving — a
      // spectator whose own connection died was being told the match had ended while the host
      // and everyone else carried on. Describe what we observed, not what we inferred.
      this.joinError = 'Perdemos a conexão com o anfitrião. Pode ser a sua rede ou a dele.';
      // Nothing left to spectate, so drop the room — but keep HOST_LEFT on screen
      // rather than falling back to the idle card.
      this.detachStream();
      this.roomSubscriptions.unsubscribe();
      this.roomSubscriptions = new Subscription();
      this.multiplayerService.leaveRoom(GameState.HOST_LEFT);
    }
  }

  private handleJoinFailure(err: any) {
    this.joinError = this.describeJoinFailure(err);
    // Settle on ERROR so the page offers a retry instead of silently resetting. No alert on
    // top of that: the ERROR card below renders this same string with a retry button, and
    // the dialog only added a tap between the guest and trying again.
    console.warn('Failed to join the room', { reason: err });
    this.resetRoomState(GameState.ERROR);
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
    // Reported rather than thrown: this now runs from the stream subscription, where a
    // throw would surface as an unhandled error instead of reaching a caller. The element
    // is static in the template, so this only fires if the page is being torn down.
    if (!video) {
      console.error('Cannot attach the stream: #stream-target is not in the DOM.');
      return;
    }

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
    // Must run BEFORE align: align reads the video's box, so the box has to be final first.
    this.fitVideoToContainer(video);
    OverlaySyncHelper.align(overlay, video);
    // Must run AFTER align: repositionAll reads the overlay's fresh offsetWidth/Height.
    CursorRendererHelper.repositionAll(overlay);
  };

  /**
   * Size the video to the container from the frame's *ratio*, not its pixel count.
   *
   * The CSS letterboxing this replaces derived the used size from the video's intrinsic
   * width, clamped by `max-width/height: 100%`. That silently conflates two different
   * events: a DOS video-mode change (the ratio changes — must re-fit) and WebRTC ramping its
   * encoder up from a low starting resolution (the ratio is identical — must NOT re-fit).
   * The second is the common case on every join, and it made the picture visibly grow from a
   * small box to the full container over the first seconds of a stream.
   *
   * The border box still equals the visible picture, which is the contract the cursor
   * overlay depends on — `Math.min` guarantees the computed box never exceeds the container
   * and exactly fills one axis, so the `max-*` pair in the stylesheet stays a no-op safety
   * net rather than the mechanism.
   */
  private fitVideoToContainer(video: HTMLVideoElement) {
    const container = video.parentElement;
    if (!container) return;

    const { videoWidth, videoHeight } = video;
    // No metadata yet; the loadedmetadata listener will call back.
    if (!videoWidth || !videoHeight) return;

    const { clientWidth, clientHeight } = container;
    // Measured inside the `ion-hide` subtree on the first pass. The container observer
    // re-runs this once the class flips, so bailing here is correct rather than clamping to 0.
    if (!clientWidth || !clientHeight) return;

    const scale = Math.min(clientWidth / videoWidth, clientHeight / videoHeight);
    video.style.width = `${Math.round(videoWidth * scale)}px`;
    video.style.height = `${Math.round(videoHeight * scale)}px`;
  }
}
