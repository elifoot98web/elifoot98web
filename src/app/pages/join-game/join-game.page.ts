import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
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
  MultiplayerRelayHealthService,
  MultiplayerService,
  MultiplayerStreamService,
  MultiplayerUiService
} from '../../core/services/multiplayer';
import { CursorRendererHelper } from 'src/app/core/helpers/cursor-renderer.helper';
import { OverlaySyncHelper } from 'src/app/core/helpers/overlay-sync.helper';
import { ChatPanelHelper } from 'src/app/core/helpers/chat-panel.helper';
import { MULTIPLAYER, STORAGE_KEY } from 'src/app/core/models/constants';
import { LayoutHelperService, LocalStorageService, StageLayoutService, WakeLockService } from '../../core/services/shared';
import { LayoutShape, LayoutShapeHelper } from 'src/app/core/helpers/layout-shape.helper';
import { StagePlan } from 'src/app/core/helpers/stage.helper';
import { JoinWaitHelper } from 'src/app/core/helpers/join-wait.helper';

@Component({
  selector: 'app-join-game',
  templateUrl: './join-game.page.html',
  styleUrls: ['./join-game.page.scss'],
  standalone: false,
})
export class JoinGamePage implements OnInit, AfterViewInit, OnDestroy {
  /** The page's row: what StageLayoutService measures. Under an `ion-hide` until a room exists, so it measures 0x0 till then. */
  @ViewChild('stageHost', { static: true }) stageHost!: ElementRef<HTMLElement>;

  private playerName = '';
  private roomId = '';
  private password = '';
  private cursorColor = MULTIPLAYER.DEFAULT_CURSOR_COLOR;

  GameState = GameState;
  joinError = '';

  gameState: GameState = GameState.NOT_IN_ROOM;

  isChatOpen = false;

  /** The shape of the window (LayoutShapeHelper), settled: the OS keyboard does not change it. */
  shape: LayoutShape = LayoutShapeHelper.of(window.innerWidth, window.innerHeight);

  /** The page's layout as numbers (StageHelper.plan): here only whether the rail is folded to icons for the chat. */
  stagePlan: StagePlan | null = null;

  /** True only inside the host grace period, while the last frame is still on screen. */
  isReconnecting = false;

  /**
   * A join is in flight: from the moment the setup dialog is confirmed until the host's picture has arrived or the attempt has failed.
   * The waiting card is shown for it (it replaced an `ion-loading` that covered the page for up to 20 s and could not be dismissed), and
   * the card has a "Cancelar".
   */
  joining = false;
  /** How long this attempt has been waiting, refreshed once a second while it does: what the card's hint is decided from. */
  private joinElapsedMs = 0;
  private joinClock?: ReturnType<typeof setInterval>;

  /**
   * Whether the host's stream carries a sound track at all. Track presence is the whole
   * signal: a host that has switched its sound off still sends the track, silent, so the
   * button is there either way and a spectator cannot tell a muted host from a quiet game.
   */
  hasAudio = false;

  /** The spectator's own choice, and the only half of the sound state that is persisted. */
  audioMuted = false;

  /**
   * The browser refused to start the sound without a gesture, so the picture is playing
   * muted. Not a choice and not persisted: the next tap on the toggle clears it.
   */
  audioBlocked = false;

  /** True whenever the spectator is hearing nothing, for either reason. */
  get isSoundOff(): boolean {
    return this.audioMuted || this.audioBlocked;
  }
  /**
   * Whether the video surface should be on screen. A reconnect keeps it there: the whole
   * point of the grace period is that the last frame survives the blip.
   */
  get isSpectating(): boolean {
    return this.gameState === GameState.IN_ROOM || this.gameState === GameState.HOST_RECONNECTING;
  }

  /**
   * A landscape phone that is watching: the toolbar is dropped, as the host's is, and what it held (leave, the room, the
   * people, the chat and sound buttons) lives in a rail beside the picture. With the toolbar's 56 px gone the guest's
   * picture is the host's size at the same window (it was 14 to 18% smaller). Not while there is no picture: the cards
   * of joining, waiting and failing keep the toolbar and its way back.
   */
  get railed(): boolean {
    return this.shape === 'landscape-compact' && this.isSpectating;
  }

  /** Drives the badge on the chat toggle, which sits outside the chat component. */
  unreadCount$: Observable<number>;

  /**
   * Whose game this is. Read from the roster rather than from any claim, so it names the
   * peer that actually delivered the stream; empty until that peer's ident arrives.
   */
  hostName$: Observable<string>;

  /** The page is gone: a start that was queued for after its first pass must not begin laying out a dead page. */
  private destroyed = false;
  /** Lives as long as the page. */
  private pageSubscriptions = new Subscription();
  /** Recreated per room, so a rejoin does not stack duplicate cursor subscriptions. */
  private roomSubscriptions = new Subscription();
  private stopObservingOverlay?: () => void;

  constructor(
    private route: ActivatedRoute,
    private multiplayerService: MultiplayerService,
    private multiplayerCursorService: MultiplayerCursorService,
    private multiplayerStreamService: MultiplayerStreamService,
    private multiplayerUiService: MultiplayerUiService,
    private identityService: MultiplayerIdentityService,
    private storageService: LocalStorageService,
    private relayHealthService: MultiplayerRelayHealthService,
    private wakeLock: WakeLockService,
    private layoutHelper: LayoutHelperService,
    private stageLayout: StageLayoutService,
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
    // Read well before any stream can arrive (a join needs a dialog and a round trip), so
    // `attachStream` finds the answer already here and never plays a blip of sound at
    // someone who muted the game last time.
    this.storageService.get<boolean>(STORAGE_KEY.SPECTATOR_MUTED)
      .then(muted => { this.audioMuted = !!muted; })
      .catch(err => console.warn('Could not read the saved sound preference', err));

    // A spectator who lets the screen lock leaves the room, and has no menu to ask for anything else:
    // the screen is held for as long as they are in one (WakeLockService: a room overrides the switch,
    // which this page does not read). Refreshed on every state, because the room exists a moment after
    // it is announced and is gone before the next announcement.
    this.wakeLock.start({ setting: false, inRoom: () => this.multiplayerService.isInRoom });
    this.pageSubscriptions.add(this.layoutHelper.shape$.subscribe(shape => { this.shape = shape; }));
    this.pageSubscriptions.add(this.stageLayout.plan$.subscribe(plan => { this.stagePlan = plan; }));
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

  ngAfterViewInit(): void {
    // The spectator has no deck, so no key rails: a landscape phone's left rail holds the room's controls only. Started after this
    // change-detection pass, not in it: the plan changes what the view binds, and that is NG0100 in dev mode.
    queueMicrotask(() => {
      if (this.destroyed) return;
      this.stageLayout.start(this.stageHost.nativeElement);
      this.stageLayout.setChat(this.isChatOpen);
    });
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.stopJoinClock();
    this.stageLayout.stop();
    this.wakeLock.stop();
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
    this.joining = true;
    this.startJoinClock();
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
      this.joining = false;
      this.stopJoinClock();
    }
  }

  /** The waiting card's first line: the room being entered, or the previous one still leaving (the one wait nothing can shorten). */
  get joinTitle(): string {
    if (this.gameState === GameState.WAITING_STREAM && !this.multiplayerService.isDraining) {
      return 'Aguardando a transmissão do anfitrião…';
    }
    return JoinWaitHelper.title({ roomCode: this.roomId, draining: this.multiplayerService.isDraining });
  }

  /** The waiting card's second line, once the wait is long (JoinWaitHelper). */
  get joinHint(): string | null {
    return JoinWaitHelper.hint(this.joinElapsedMs);
  }

  /** The card shows for a join in flight and for the states that mean one is (the room is entered before the picture arrives). */
  get waitingForRoom(): boolean {
    // Not once the picture is there: the attempt is still finishing for a few milliseconds after it arrived.
    if (this.isSpectating) return false;
    return this.joining || this.gameState === GameState.JOINING_ROOM || this.gameState === GameState.WAITING_STREAM;
  }

  /**
   * "Cancelar" on the waiting card. A join that is in flight cannot be undone in place: trystero keeps its connection to the host in a
   * registry that outlives the room, so joining again within this page load can reach the data channel and never the picture (see
   * reloadSpectator). The spectator has no emulator and no save state, so the way back is the same as for a failed join, a fresh page
   * load, with the code on the address so the dialog comes back filled in. The room is left first, so the host's roster updates at once.
   */
  cancelJoin() {
    this.stopJoinClock();
    this.resetRoomState();
    this.reloadSpectator(this.roomId);
  }

  private startJoinClock() {
    this.stopJoinClock();
    const began = performance.now();
    this.joinElapsedMs = 0;
    this.joinClock = setInterval(() => { this.joinElapsedMs = performance.now() - began; }, 1000);
  }

  private stopJoinClock() {
    clearInterval(this.joinClock);
    this.joinClock = undefined;
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

  /** The one place `isChatOpen` changes, because the stage has to hear of it (see GamePage.setChatOpen). */
  private setChatOpen(open: boolean) {
    this.isChatOpen = open;
    this.stageLayout.setChat(open);
  }

  toggleChat(force?: boolean) {
    const shouldOpen = typeof force === 'boolean' ? force : !this.isChatOpen;
    if (shouldOpen === this.isChatOpen) return;
    this.setChatOpen(shouldOpen);

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
    // Last, and not first: the HOST_LEFT branch above drops the room itself and announces nothing more
    // (the state is already HOST_LEFT), so this is the only look at the room after it is gone.
    this.wakeLock.refresh();
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
            'Tente outra rede (Wi-Fi em vez de dados móveis) ou desative a VPN.' +
            this.relayNote();
        case 'room-full':
          // Not "tente outra sala": the room is fine, it is just at the limit its host chose.
          // The retry button reloads and re-enters, which is what to do once someone leaves.
          return 'A sala está cheia. O anfitrião definiu um limite de espectadores e ele ' +
            'já foi atingido. Tente novamente quando alguém sair.';
      }
    }
    // rxjs `timeout` throws a TimeoutError. Silence is all we ever get for a room code
    // nobody is hosting, so this stays the catch-all.
    //
    // Not "check the code and password" alone. The 20 s wait runs out before trystero reports a
    // failed connection (about 23 s after the offer), so a guest who did find the host but could
    // not connect lands here too, and was being sent off to re-check a code that was never wrong.
    if (err?.name === 'TimeoutError') {
      return 'Não recebemos a transmissão. Confira o código da sala, a senha e se o anfitrião ' +
        'já começou a hospedar. Se tudo estiver certo, tente outra rede (Wi-Fi em vez de dados ' +
        'móveis) ou sem VPN: a rede de um dos dois lados pode estar impedindo a conexão.' +
        this.relayNote();
    }
    return err?.message || 'Erro ao entrar na sala.';
  }

  /**
   * A trailing sentence for connection failures, only when the relay is known to be down. It
   * explains why the networks the advice above names are the ones that fail.
   */
  private relayNote(): string {
    return this.relayHealthService.health === 'unavailable'
      ? ' O servidor de relay está inacessível no momento, o que dificulta conexões nessas redes.'
      : '';
  }

  private resetRoomState(nextState: GameState = GameState.NOT_IN_ROOM) {
    this.detachStream();
    this.roomSubscriptions.unsubscribe();
    this.roomSubscriptions = new Subscription();
    this.setChatOpen(false);
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

  /**
   * Start the picture, and the sound if the browser allows it.
   *
   * Sound is the spectator's call and the browser's: the property is set BEFORE `srcObject`
   * so a muted spectator never hears a blip, and set on the element rather than as the
   * template attribute, which Angular does not reflect into `muted`. When autoplay policy
   * says no (a Safari page whose gesture has gone stale), the picture is more important
   * than the sound, so it falls back to muted and `audioBlocked` asks for a tap. Every
   * attach runs this, so the picture recovered after a host blip gets the same treatment.
   */
  private async startPlayback(video: HTMLVideoElement, stream: MediaStream) {
    try {
      await video.play();
    } catch (err: any) {
      // Anything but a policy refusal is not ours to fix: AbortError is a newer attach
      // replacing this one, and that attach will make its own attempt.
      if (err?.name !== 'NotAllowedError' || video.srcObject !== stream) return;
      if (video.muted) {
        console.warn('The browser refused to play even muted.', err);
        return;
      }
      video.muted = true;
      this.audioBlocked = this.hasAudio;
      try {
        await video.play();
      } catch (retryErr) {
        console.warn('The browser refused to play the stream.', retryErr);
      }
    }
  }

  /**
   * The sound toggle. Also the way out of `audioBlocked`: the tap is the gesture the
   * browser was waiting for, so unmuting here is allowed where autoplay was not.
   */
  async toggleAudio() {
    const video = this.getVideoElement();
    if (!video) return;

    this.audioMuted = !this.isSoundOff;
    this.audioBlocked = false;
    video.muted = this.audioMuted;
    if (video.paused) video.play().catch(err => console.warn('Could not resume the stream', err));

    await this.storageService.set<boolean>(STORAGE_KEY.SPECTATOR_MUTED, this.audioMuted);
  }

  /** Sound-toggle label, naming the action the tap will perform. */
  soundToggleLabel(): string {
    return this.isSoundOff ? 'Ativar o som do jogo' : 'Silenciar o som do jogo';
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

    this.hasAudio = stream.getAudioTracks().length > 0;
    this.audioBlocked = false;
    video.muted = this.audioMuted;
    video.srcObject = stream;
    void this.startPlayback(video, stream);
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
