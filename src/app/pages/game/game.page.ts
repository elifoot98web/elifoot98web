import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertController, LoadingController, ModalController, ToastController } from '@ionic/angular/lazy';
import { AlertButton } from '@ionic/core';
import JSZip from 'jszip';
import { environment } from 'src/environments/environment';
import { AUDIO_HEALTH, AUTO_SAVER, DISPLAY_MODE, EMULATOR_CONTROL_CONFIG, EMULATOR_POWER, GAME_BOOT, GAME_EXIT_WATCH, MULTIPLAYER, PLATFORM_NUDGES, SAVE_SAFETY, STORAGE_KEY, WAKE_LOCK } from '../../core/models/constants';
import { TypeBarComponent, TypeBarNotice } from '../../core/components/type-bar/type-bar.component';
import { FieldHint } from '../../core/helpers/field-hint.helper';
import { UserGuideComponent } from './components/user-guide/user-guide.component';
import { AboutComponent } from './components/about/about.component';
import { OmaticModalComponent } from './components/omatic-modal/omatic-modal.component';
import { DiagnosticsModalComponent } from './components/diagnostics-modal/diagnostics-modal.component';
import { AdvancedEvent, AdvancedHost, AdvancedModalComponent } from './components/advanced-modal/advanced-modal.component';
import { FirstRunCoachComponent } from './components/first-run-coach/first-run-coach.component';
import { MenuEvent } from './components/options-menu/options-menu.component';
import { BehaviorSubject, combineLatest, distinctUntilChanged, filter, map, Observable, Subscription, take } from 'rxjs';
import { EmulatorKeyCodeHelper } from '../../core/models/game';
import { CursorClickMessage, CursorPositionMessage, MultiplayerJoinErrorKind, PlayerInfo } from '../../core/models/multiplayer';
import { AudioHealthService, AutoSaverService, CameraService, CameraSurface, CameraView, EmulatorControlService, EmulatorPowerService, FieldHintService, GameExitWatcherService, PatchService, SaveBeforeReloadResult, SaveGameService, SaveImportPlan, SaveSafetyService, SavesBackup, TouchInputService } from '../../core/services/game';
import { DiagnosticsService, FullscreenService, InstallService, LayoutHelperService, LocalStorageService, NudgeStateService, SaveStatusService, StageLayoutService, WakeLockService } from '../../core/services/shared';
import { MultiplayerAudioService, MultiplayerChatService, MultiplayerCursorService, MultiplayerPlayerInfoService, MultiplayerRelayHealthService, MultiplayerService, MultiplayerUiService } from '../../core/services/multiplayer';
import { CursorRendererHelper } from 'src/app/core/helpers/cursor-renderer.helper';
import { OverlaySyncHelper } from 'src/app/core/helpers/overlay-sync.helper';
import { ChatPanelHelper } from 'src/app/core/helpers/chat-panel.helper';
import { BootFailureHelper, BootFailureKind } from 'src/app/core/helpers/boot-failure.helper';
import { BootProgressHelper, BootStatus } from 'src/app/core/helpers/boot-progress.helper';
import { BootScreenHelper } from 'src/app/core/helpers/boot-screen.helper';
import { BootStage, BootStageHelper } from 'src/app/core/helpers/boot-stage.helper';
import { TimeoutHelper } from 'src/app/core/helpers/timeout.helper';
import { DisplayMode, DisplayModeHelper } from 'src/app/core/helpers/display-mode.helper';
import { TouchMode, TouchModeHelper } from 'src/app/core/helpers/touch-mode.helper';
import { DeckLayoutHelper, DeckPresentation, DeckSetting } from 'src/app/core/helpers/deck-layout.helper';
import { StageHelper, StagePlan, StageView } from 'src/app/core/helpers/stage.helper';
import { ViewportTransform } from 'src/app/core/helpers/viewport-transform.helper';
import { DeckPanel } from 'src/app/core/helpers/deck-panel.helper';
import { SaveBackupHelper } from 'src/app/core/helpers/save-backup.helper';
import { SaveStatusHelper } from 'src/app/core/helpers/save-status.helper';
import { NavigationGuardHelper } from 'src/app/core/helpers/navigation-guard.helper';
import { EmulatorPowerHelper } from 'src/app/core/helpers/emulator-power.helper';
import { WakeLockHelper } from 'src/app/core/helpers/wake-lock.helper';
import { FullscreenHelper } from 'src/app/core/helpers/fullscreen.helper';
import { InstallHelper, InstallMode } from 'src/app/core/helpers/install.helper';
import { NudgeHelper } from 'src/app/core/helpers/nudge.helper';
import { GameVolumeHelper } from 'src/app/core/helpers/audio-health.helper';
import { InvertedSettingHelper } from 'src/app/core/helpers/inverted-setting.helper';
import { MenuContext, MenuHelper, MenuSection } from 'src/app/core/helpers/menu.helper';
import { HelpTopic } from 'src/app/core/helpers/help-topic.helper';
import { FirstRunHelper } from 'src/app/core/helpers/first-run.helper';
import { WipeFlowHelper } from 'src/app/core/helpers/wipe-flow.helper';
import { RoomSetupResult } from 'src/app/core/components/multiplayer/room-setup-modal/room-setup-modal.component';


@Component({
    selector: 'app-game',
    templateUrl: './game.page.html',
    styleUrls: ['./game.page.scss'],
    standalone: false
})
export class GamePage implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('popover') popover: any;
  /** The two pickers of "Dados e avançado": they live in the page, because a picker opens only from the tap that asked for it. */
  @ViewChild('patchFileInput', { static: true }) patchFileInput!: ElementRef<HTMLInputElement>;
  @ViewChild('saveGameFileInput', { static: true }) saveGameFileInput!: ElementRef<HTMLInputElement>;
  /** The page's row: what StageLayoutService measures, and the parent of the picture's container, the rails and the chat. */
  @ViewChild('stageHost', { static: true }) stageHost!: ElementRef<HTMLElement>;
  /** The live type bar, while it is mounted (the setting is on and the deck is shown). */
  @ViewChild(TypeBarComponent) typeBar?: TypeBarComponent;
  // UI state properties
  /**
   * "Suavizar a imagem": what the screen says, in the positive. The key it is kept under (STORAGE_KEY.DISABLE_SMOOTH_FILTER) is
   * the OFF flag it always was, so a player who upgrades keeps the choice; InvertedSettingHelper is the one place that converts.
   */
  smoothing = true;
  spectatorCursorsHidden = false;
  spectatorAudioDisabled = false;
  private latestCursors: { [peerId: string]: CursorPositionMessage } = {};
  /** "Salvar ao gravar o jogo", in the positive; the key is STORAGE_KEY.DISABLE_AUTO_SAVE, stored as the OFF flag (see above). */
  autoSaveOnGame = true;
  /** "Salvar a cada 5 min" (STORAGE_KEY.PERIODIC_SAVE, stored as it reads). */
  periodicSave = false;
  /** The desktop's popover is open. */
  isPopoverOpen = false;
  /** The touch screen's bottom sheet is open. */
  isSheetOpen = false;
  /** How tall the sheet opens (MenuHelper.initialBreakpoint), chosen each time it is opened: a rotation changes the answer. */
  sheetInitialBreakpoint = 0.6;
  readonly sheetBreakpoints = [0, 0.6, 1];
  isHidden = true;
  dosCI: any = null;
  versionConfig = environment.versionConfig;

  // multiplayer properties
  isHosting = false;
  isStreaming = false;
  isChatOpen = false;
  hostRoomId = '';
  hostPassword = '';
  hostName = '';
  hostColor = MULTIPLAYER.DEFAULT_CURSOR_COLOR;
  /** How many spectators this room accepts; the host is not counted. */
  hostMaxSpectators = MULTIPLAYER.DEFAULT_MAX_SPECTATORS;

  /** Drives the badge on the chat toggle, which sits outside the chat component. */
  unreadCount$: Observable<number>;

  /** Feeds the menu entry's state subtitle, so the menu answers "how many" when opened. */
  participantCount$: Observable<number>;

  /**
   * The shape of the page and how the control deck is presented in it (DeckLayoutHelper): the
   * toolbar, the deck's band or launcher, and where the launcher lives all follow from this one
   * value, which is recomputed whenever the viewport, the primary pointer or the setting changes.
   * A field and not an async pipe, because half the template reads it.
   */
  layout: DeckPresentation;
  /** The player's word on the deck (STORAGE_KEY.DECK_MODE); the default follows the device. */
  deckSetting: DeckSetting = 'auto';
  private readonly deckSetting$ = new BehaviorSubject<DeckSetting>('auto');
  /** The launcher's sheet is open. Only meaningful where the deck is a launcher or a landscape phone's rails. */
  deckSheetOpen = false;
  /**
   * The page's layout as numbers (StageHelper.plan, written by StageLayoutService): the columns of keys in each rail, the
   * widths the chat and the rails take, the picture's box. Null until the row has been measured.
   */
  stagePlan: StagePlan | null = null;
  /** "Tamanho da imagem" (STORAGE_KEY.STAGE_VIEW): Ajustar or Ampliar. */
  stageView: StageView = 'fit';
  /** Whether the keys buzz the phone (STORAGE_KEY.DISABLE_KEY_VIBRATION, inverted); the device still has to be able to. */
  keyVibration = true;
  readonly canVibrate = typeof navigator.vibrate === 'function';
  /**
   * EXPERIMENTAL (STORAGE_KEY.LIVE_KEYBOARD, off by default): Texto opens the live type bar instead of
   * the compose dialog. Read before the boot, like the deck's settings, so the bar is not mounted late.
   */
  liveKeyboard = false;
  /** Whether a text field seems to have the focus in the guest (FieldHintService). Only a cue. */
  fieldHint: FieldHint = 'none';
  /** `(any-pointer: coarse)`: only to tell, in the menu, why an automatic deck is hidden on a device that has a touch screen. */
  anyCoarse = false;
  /**
   * "Economizar bateria quando parado" (STORAGE_KEY.IDLE_PAUSE): the emulator sleeps while the
   * screen is still. What the person chose, or {@link EMULATOR_POWER.DEFAULT_ENABLED} for one who never did.
   */
  idlePause: boolean = EMULATOR_POWER.DEFAULT_ENABLED;
  /** How long a still screen has to stay still before the saver acts: the number the menu's description quotes. */
  readonly idleSeconds = Math.round(EMULATOR_POWER.IDLE_MS / 1000);

  /**
   * "Manter a tela ligada" (STORAGE_KEY.KEEP_AWAKE): the screen does not lock while the game runs. What
   * the person chose, or {@link WAKE_LOCK.DEFAULT_ENABLED} for one who never did; a room holds it anyway.
   */
  keepAwake: boolean = WAKE_LOCK.DEFAULT_ENABLED;
  /** The game's volume in percent and whether it is muted: the host's headphones, which spectators do not hear. */
  volumePercent = Math.round(AUDIO_HEALTH.DEFAULT_VOLUME * 100);
  gameMuted = false;
  readonly volumeStep = AUDIO_HEALTH.VOLUME_STEP_PERCENT;
  /** "Som no modo silencioso" (STORAGE_KEY.AUDIO_PLAYBACK): `navigator.audioSession.type = 'playback'`, off unless chosen. */
  audioPlayback = false;
  /** Whether this browser can go fullscreen at all; iPhone Safari cannot, and the entry is not offered there. */
  fullscreenSupported = false;
  fullscreenActive = false;
  /** What the app can offer about being installed (InstallService); the menu entry and the banner follow it. */
  installMode: InstallMode = 'none';
  /**
   * Whether the options menu offers "Modo de toque": a finger is the primary pointer AND the
   * classic touchpad would work on this device (see TouchModeHelper). Reactive, because a
   * convertible changes its primary pointer when the keyboard is detached.
   */
  touchModeChoice$: Observable<boolean>;
  /** The last answer of {@link touchModeChoice$}, for the menu model (a pure function of plain values). */
  touchModeOffered = false;
  /** The person's choice. What is actually in force is {@link TouchModeHelper.effective}. */
  touchMode: TouchMode = 'direct';

  /**
   * "Zoom e movimento" (STORAGE_KEY.CAMERA_ENABLED): the in-app camera on the host's picture (CameraService). Offered where a finger is
   * the pointer, and off as shipped (CAMERA.DEFAULT_ENABLED): nobody has seen it on a phone.
   */
  cameraEnabled = false;
  /** What the camera is doing, for the deck's Zoom tab and for the portrait layout. */
  cameraView: CameraView = { attached: false, enabled: false, scale: 1, zoomed: false, label: 'Ajustar', canZoomIn: false, canZoomOut: false };
  /** The panel the deck has up in its band (null when folded): the camera takes the band under the picture only while there is none. */
  deckShown: DeckPanel | null = null;
  /** Whether "Dados e avançado" offers "Zoom e movimento": the same test as "Modo de toque", a finger is the pointer. */
  cameraChoice$: Observable<boolean>;
  cameraOffered = false;
  /** Unread chat messages and the roster's size, kept as numbers for the menu model (the template's async pipes cannot feed it). */
  private unreadMessages = 0;
  private participantCount = 0;
  private menuKey = '';
  private menuCache: MenuSection[] = [];

  private static readonly KEY_FAILURE_REPORT_INTERVAL_MS = 5000;
  private lastKeyFailureAt = 0;

  private multiplayerSubscriptions = new Subscription();
  /** The page's own, for as long as it lives; the room's are the ones above. */
  private pageSubscriptions = new Subscription();
  private stopObservingOverlay?: () => void;

  /**
   * The boot screen is up: the emulator is starting and the game's own screen has not been seen. A flag the template reads, and not an
   * overlay to dismiss, so leaving the page mid-boot strands nothing.
   */
  booting = false;
  bootStatus: BootStatus = BootScreenHelper.initial();
  /**
   * The room dialog `?host=1` opens while the emulator boots, and what it answered. The dialog needs no emulator and hosting needs
   * one, so the dialog goes first and the room starts when the game is up (bootGame): never a reload, which would end the room.
   */
  private hostDialog?: Promise<RoomSetupResult | null>;
  /** The person answered the dialog and the game is still starting: the boot screen says the room is waiting for it. */
  hostWaitingForBoot = false;
  /**
   * The timeout or failure dialog while it is up. Alerts are app-level overlays that outlive the
   * route, so one left open when the person presses Back would float over the landing page
   * offering to wait for, or wipe the disk of, a game they are no longer on.
   */
  private bootAlert?: Awaited<ReturnType<AlertController['create']>>;
  private destroyed = false;
  /** The js-dos loading text last written to the diagnostics log, at ten-percent resolution. */
  private lastLoaderStep = '';
  /**
   * The page is on its way out on purpose (leaving, or a save-then-reload): the route guard must
   * let the navigation through, and the browser must not ask "leave site?". Never set back.
   */
  private leaving = false;
  /** The leave dialog is open; a second Back must not stack another on top of it. */
  private leavePromptOpen = false;
  /** The "O Elifoot foi fechado" dialog is open. */
  private exitBannerOpen = false;
  /** The boot saw the game's own screen, which is what lets the exit watcher run (see startSafetyNets). */
  private gameDetected = false;
  private exitSubscription?: Subscription;
  /** `startSafetyNets` has run and `stopSafetyNets` has not: the idle pause is one of the nets. */
  private netsUp = false;
  /** The one-time toast while it is up (the install banner or the rotate hint), so leaving the page does not strand it. */
  private nudgeToast?: Awaited<ReturnType<ToastController['create']>>;

  constructor(
    private loadingController: LoadingController,
    private alertController: AlertController,
    private modalController: ModalController,
    private toastController: ToastController,
    private saveGameService: SaveGameService,
    private patchService: PatchService,
    private storageService: LocalStorageService,
    private emulatorControlService: EmulatorControlService,
    private autoSaverService: AutoSaverService,
    private layoutHelperService: LayoutHelperService,
    private route: ActivatedRoute,
    private router: Router,
    private multiplayerService: MultiplayerService,
    private multiplayerCursorService: MultiplayerCursorService,
    private multiplayerUiService: MultiplayerUiService,
    private playerInfoService: MultiplayerPlayerInfoService,
    private multiplayerAudioService: MultiplayerAudioService,
    private relayHealthService: MultiplayerRelayHealthService,
    private diagnostics: DiagnosticsService,
    private touchInputService: TouchInputService,
    private saveSafety: SaveSafetyService,
    private saveStatus: SaveStatusService,
    private exitWatcher: GameExitWatcherService,
    private fieldHintService: FieldHintService,
    private power: EmulatorPowerService,
    private wakeLock: WakeLockService,
    private audioHealth: AudioHealthService,
    private fullscreen: FullscreenService,
    private install: InstallService,
    private nudges: NudgeStateService,
    private stageLayout: StageLayoutService,
    private camera: CameraService,
    private zone: NgZone,
    chatService: MultiplayerChatService
  ) {
    this.unreadCount$ = chatService.unreadCount$;
    this.fullscreenSupported = this.fullscreen.supported;
    this.participantCount$ = this.playerInfoService.playerList$.pipe(map(players => players.length));
    // The menu model is a pure function of plain values, so what the template reads through async pipes is kept as numbers as well.
    this.pageSubscriptions.add(this.unreadCount$.subscribe(count => { this.unreadMessages = count; }));
    this.pageSubscriptions.add(this.participantCount$.subscribe(count => { this.participantCount = count; }));
    this.layout = DeckLayoutHelper.presentation({
      viewport: { width: window.innerWidth, height: window.innerHeight },
      touchPrimary: this.layoutHelperService.isTouchPrimary,
      setting: this.deckSetting,
    });
    this.pageSubscriptions.add(combineLatest([
      this.layoutHelperService.viewport$,
      this.layoutHelperService.isTouchPrimary$,
      this.deckSetting$,
    ]).pipe(
      map(([viewport, touchPrimary, setting]) => DeckLayoutHelper.presentation({ viewport, touchPrimary, setting })),
      distinctUntilChanged(DeckLayoutHelper.samePresentation),
    ).subscribe(layout => {
      this.layout = layout;
      this.diagnostics.log('page', 'deck layout', () => ({ ...layout, setting: this.deckSetting }));
      // A sheet belongs to a launcher or to rails; one left open across a rotation into the band would reopen with it.
      if (layout.kind !== 'launcher' && layout.kind !== 'rails') this.deckSheetOpen = false;
      // Without the band there is no panel in it (the dock announces nothing once it is gone).
      if (layout.kind !== 'band') this.deckShown = null;
      // The rails carry keys only where the deck is shown (a landscape phone); the plan sizes them to match.
      this.stageLayout.setKeys(layout.kind === 'rails');
    }));
    this.pageSubscriptions.add(this.stageLayout.plan$.subscribe(plan => { this.stagePlan = plan; }));
    this.pageSubscriptions.add(this.camera.view$.subscribe(view => { this.cameraView = view; }));
    this.pageSubscriptions.add(this.layoutHelperService.anyCoarse$.subscribe(coarse => { this.anyCoarse = coarse; }));
    this.pageSubscriptions.add(this.fieldHintService.hint$.subscribe(hint => { this.fieldHint = hint; }));
    this.pageSubscriptions.add(this.install.mode$.subscribe(mode => { this.installMode = mode; }));
    this.pageSubscriptions.add(this.fullscreen.active$.subscribe(active => { this.fullscreenActive = active; }));
    // A room opening or closing changes whether the screen is held whatever the switch says. The state
    // is announced after the room exists (and, on leaving, after it is gone), so refresh() reads the truth.
    this.pageSubscriptions.add(this.multiplayerService.gameStateSubject.subscribe(() => this.wakeLock.refresh()));
    this.touchModeChoice$ = this.layoutHelperService.matches$('(pointer: coarse)').pipe(
      map(coarse => TouchModeHelper.offersChoice(coarse, navigator.userAgent))
    );
    this.cameraChoice$ = this.layoutHelperService.matches$('(pointer: coarse)');
    this.pageSubscriptions.add(this.touchModeChoice$.subscribe(offered => { this.touchModeOffered = offered; }));
    this.pageSubscriptions.add(this.cameraChoice$.subscribe(offered => { this.cameraOffered = offered; }));
  }

  /**
   * The one "debug" switch: the diagnostics log. This used to be a field that was always
   * `false` and that nothing could set; it gates "Baixar disco virtual" in "Dados e avançado", which
   * is a developer's tool, and turning the diagnostics on is the same kind of decision.
   */
  get debugMode(): boolean {
    return this.diagnostics.enabled
  }

  /** The subtitle of the "Salvar agora" menu entry: what the toolbar chip says, for the layouts that have no toolbar. */
  get saveSummary(): string {
    return SaveStatusHelper.describe(this.saveStatus.snapshot, Date.now()).text
  }

  ngAfterViewInit(): void {
    // The row is in the DOM (static: it is not under an *ngIf), so it has a size to plan around. Not in this very pass: the plan
    // changes what the view binds (the rails' columns), and a change made while the view is being checked is NG0100 in dev mode.
    queueMicrotask(() => {
      if (this.destroyed) return
      this.stageLayout.start(this.stageHost.nativeElement)
      this.stageLayout.setKeys(this.layout.kind === 'rails')
      this.stageLayout.setView(this.stageView)
      this.stageLayout.setChat(this.isChatOpen)
    })
  }

  async ngOnInit() {
    console.time("carregando game...")
    // Not awaited: the chip shows "Ainda não salvo" for the few milliseconds it takes, and the
    // boot has nothing to wait for.
    void this.saveStatus.load()
    // Before the boot and not with the other settings after it: the deck is on screen behind the
    // boot screen, and a player who switched it off should not see it come and go.
    void this.setupDeck()
    // The landing page's "Jogar e transmitir para amigos" (and the PWA's "Hospedar" shortcut): the room dialog needs no emulator, so it
    // is asked for now, while the game boots, and the room starts when the game is up (bootGame). Not awaited: the boot must not wait
    // for a person to fill in a form.
    if (this.route.snapshot.queryParamMap.get('host') === '1') {
      this.hostDialog = this.askForRoomWhileBooting()
    }
    await this.bootGame()
  }

  /**
   * Start the emulator and, once it is up, make the page usable. Can run more than once per page
   * load: "Continuar esperando" after a timeout comes back here, and `elifootMain` re-attaches to
   * the boot that is still running.
   *
   * Only a failure to START the emulator is a boot failure. What follows (settings, the room asked
   * for with `?host=1`, the first-run coach) runs with a working game behind it, so an exception there is
   * logged and reported but never reloads the page, which is what the old catch-all did to a
   * game that was running fine.
   */
  private async bootGame() {
    this.booting = true
    this.bootStatus = BootScreenHelper.initial()
    this.diagnostics.log('boot', 'boot start')

    let detected: boolean;
    try {
      ({ detected } = await this.loadGame(status => this.showBootStatus(status)));
    } catch (e) {
      this.endBoot()
      await this.handleBootFailure(e);
      return;
    }

    if (this.destroyed) {
      this.endBoot()
      return;
    }

    // The emulator started, so the failures in a row are over, whether or not its screen showed.
    // Its own try: with site data blocked every Ionic Storage write rejects while js-dos itself
    // boots fine, and that must not leave the boot screen over a running game.
    try {
      await this.storageService.set(STORAGE_KEY.FAIL_COUNT, 0)
    } catch (e) {
      console.warn('Could not reset the failure count', e)
    }
    console.timeEnd("carregando game...")

    try {
      await this.loadConfig(detected)
    } catch (e) {
      console.error('Could not apply the saved settings', e)
    }
    this.isHidden = false
    this.endBoot()
    // After the picture has its box (the game was hidden, and without `.full` the container has no size to put a camera on).
    try {
      await this.setupCamera()
    } catch (e) {
      console.error('Could not set up the camera', e)
    }

    try {
      // The room first when the person came to host (its dialog has been open, or answered, since the boot began); the coach is for
      // the visit that was not about something else. A coach over a room that has just gone on the air would be noise.
      const hosted = await this.startRoomAskedForWhileBooting()
      if (detected) {
        await this.handleShowFirstRun(hosted)
      } else {
        // A coach over a screen that never rendered is worse than silence, but
        // silence is not an answer either: the guest may just be slow.
        console.warn('Game screen was never detected; skipping the first-run coach.')
        await this.multiplayerUiService.showToast('O jogo ainda está iniciando…', 'warning', 6000)
      }
    } catch (e) {
      console.error(e)
      await this.showErrorAlert(e instanceof Error ? e : new Error(String(e)))
    }
    // After the first-run coach and the room, and not awaited: it waits for the player.
    void this.maybeNudge()
  }

  /**
   * What js-dos and then the guest said about the boot, for the boot screen. The callbacks come from a MutationObserver on js-dos's
   * loading text and from the polling loop; either way the page's view has to hear of it, hence the zone.
   */
  private showBootStatus(status: BootStatus) {
    this.zone.run(() => { this.bootStatus = status })
  }

  /** Take the boot screen down. The game is up, or the boot failed and a dialog is about to say so. */
  private endBoot() {
    this.booting = false
    this.hostWaitingForBoot = false
  }

  /**
   * "Voltar ao menu" on the boot screen. The emulator has not been played, so there is nothing to save, and a download or a boot in
   * flight cannot be cancelled from here (`stop()` does not reach it): the reload is what actually stops them. The route guard has
   * nothing to ask either, because `leaving` says the navigation is this one.
   */
  leaveBoot() {
    this.diagnostics.log('boot', 'left during the boot')
    this.leaving = true
    this.saveStatus.allowExit()
    window.location.hash = '#/main'
    window.location.reload()
  }

  /**
   * The three answers to "the emulator did not come up", each with its own way out.
   *
   * A timeout is not a failure: nothing counts against the user, nothing reloads, and the
   * download keeps going behind the dialog. Anything else is counted, because the count decides
   * whether the dialog may offer to wipe the saved disk (see BootFailureHelper.offersWipe).
   */
  private async handleBootFailure(error: unknown) {
    console.error('The game did not load', error)
    if (this.destroyed) return;

    const kind = BootFailureHelper.kindOf(error)
    this.diagnostics.log('boot', 'failed', () => ({ kind, error }))
    if (kind === 'timeout') {
      await this.offerToKeepWaiting(error)
      return
    }

    const failures = (await this.storageService.get<number>(STORAGE_KEY.FAIL_COUNT) || 0) + 1
    await this.storageService.set(STORAGE_KEY.FAIL_COUNT, failures)
    await this.showBootFailure(kind, failures)
  }

  private async offerToKeepWaiting(error: unknown) {
    const alert = await this.alertController.create({
      header: 'O jogo está demorando',
      cssClass: 'win9x-alert alert-whitespace',
      message: BootFailureHelper.timeoutMessage(error),
      backdropDismiss: false,
      buttons: [
        { text: 'Continuar esperando', role: 'wait' },
        {
          text: 'Tentar de novo',
          handler: () => {
            window.location.reload()
          }
        }
      ]
    });
    this.bootAlert = alert;
    await alert.present();
    const { role } = await alert.onDidDismiss();
    this.diagnostics.log('boot', 'timeout dialog answered', () => ({ role: role ?? 'reload' }))
    if (this.bootAlert === alert) this.bootAlert = undefined;
    // Not once the page is gone: bootGame() would start a boot (and its polling) that nothing on a
    // destroyed page is watching.
    if (role === 'wait' && !this.destroyed) {
      await this.bootGame()
    }
  }

  private async showBootFailure(kind: Exclude<BootFailureKind, 'timeout'>, failures: number) {
    const buttons: AlertButton[] = [
      {
        text: 'Tentar de novo',
        handler: () => {
          window.location.reload()
        }
      },
      {
        // Reads IndexedDB directly: there is no emulator, so no dosCI to persist from. Returns
        // false to leave the dialog up, because the next thing the person may do is the wipe.
        text: 'Baixar cópia dos meus dados',
        handler: async () => {
          await this.downloadStoredBackup()
          return false
        }
      }
    ]
    if (BootFailureHelper.offersWipe(kind, failures)) {
      buttons.push({
        text: 'Apagar todos os dados…',
        cssClass: 'alert-danger',
        // The same two questions as the menu's: a boot that failed is not a reason to skip the backup. This dialog stays up under
        // them (false), so that "Cancelar" at either question brings the person back to "Tentar de novo".
        handler: () => {
          void this.confirmWipe()
          return false
        }
      })
    }

    const alert = await this.alertController.create({
      header: 'O jogo não carregou',
      cssClass: 'win9x-alert alert-whitespace',
      message: BootFailureHelper.failureMessage(kind, failures),
      backdropDismiss: false,
      buttons
    });
    this.bootAlert = alert;
    await alert.present();
  }

  private async downloadStoredBackup() {
    try {
      const saved = await this.saveGameService.downloadStoredChanges()
      await this.multiplayerUiService.showToast(
        saved ? 'Cópia dos seus dados baixada.' : 'Não há dados salvos neste navegador para copiar.',
        saved ? 'success' : 'warning', 4000)
    } catch (e) {
      console.error('Could not read the stored data', e)
      await this.showErrorAlert(new Error('Não foi possível ler os dados salvos neste navegador.'))
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.stopSafetyNets();
    // Ends the detection loop in waitForGameScreen(). The boot screen is this page's own template, so it goes with it.
    void this.bootAlert?.dismiss(undefined, 'destroyed').catch(() => undefined);
    // The queue is a root service and outlives this page; whatever it still holds is typing
    // meant for this page's emulator.
    this.emulatorControlService.cancelKeys();
    // Both are root services too. Left running they would keep sampling a dead emulator (the loop
    // now survives errors by design) and keep the OCR worker's memory for the rest of the visit.
    this.autoSaverService.stop();
    this.autoSaverService.stopPeriodicSave();
    // The layer is a root service too: its listeners sit on this page's container, and it holds
    // the emulator. Detaching also releases a button the guest may have been left holding.
    this.touchInputService.detach('page destroyed');
    // After the layer: it ends a pinch that is still going, and the camera takes its transform off the page.
    this.camera.detach('page destroyed');
    this.fieldHintService.stop();
    this.stopObservingOverlay?.();
    // Root services too, and each holds something of the browser: the screen lock, a document
    // listener for the audio context, the fullscreen (and the orientation lock that came with it).
    this.wakeLock.stop();
    this.audioHealth.stop();
    this.fullscreen.stop();
    // The stage's properties are on <html>: a page that is gone must not leave its picture's size to the next one.
    this.stageLayout.stop();
    void this.nudgeToast?.dismiss(undefined, 'destroyed').catch(() => undefined);
    this.pageSubscriptions.unsubscribe();
    this.multiplayerSubscriptions.unsubscribe();
    // Without this the room, its ping interval and the canvas capture outlive the page.
    this.multiplayerService.leaveRoom();
  }

  /**
   * Boot the emulator and wait for the game's own screen.
   *
   * Returns whether it was actually seen: the polling loop exits both on success and when the
   * window closes, and resolving identically for both meant a failed boot went on to show the
   * first-run coach over a black screen.
   *
   * `onStatus` hears what the boot screen should say, in Portuguese: first the download and the
   * unpacking (js-dos's own text, through BootProgressHelper), then the stage the guest is in.
   * A rejection is `elifootMain`'s own: the real error, or a JsdosTimeoutError that is only the
   * end of one wait (see bootGame).
   */
  async loadGame(onStatus?: (status: BootStatus) => void): Promise<{ detected: boolean }> {
    const began = performance.now()
    this.dosCI = await elifootMain(environment.prefixPath, environment.gameBundleURL, loaderText => {
      const step = BootProgressHelper.logStep(loaderText)
      if (step !== this.lastLoaderStep) {
        this.lastLoaderStep = step
        this.diagnostics.log('boot', 'js-dos says', () => ({ text: loaderText }))
      }
      const status = BootProgressHelper.status(loaderText)
      if (status) onStatus?.(status)
    })
    this.diagnostics.log('boot', 'emulator ready', () => ({ ms: Math.round(performance.now() - began) }))

    return { detected: await this.waitForGameScreen(onStatus) }
  }

  /**
   * Poll the framebuffer until it shows the game's green or `DETECTION_TIMEOUT_MS` passes,
   * telling `onStatus` which stage of the boot each look found. Windows 3.1 on a phone can take
   * most of a minute to get here, and this window is where the person would otherwise be
   * looking at nothing.
   */
  private async waitForGameScreen(onStatus?: (status: BootStatus) => void): Promise<boolean> {
    const deadline = Date.now() + GAME_BOOT.DETECTION_TIMEOUT_MS
    const began = performance.now()
    const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

    let stage: BootStage = 'dos'
    onStatus?.(BootScreenHelper.fromStage(stage))

    // wait for the js-dos to settle
    await pause(GAME_BOOT.DETECTION_SETTLE_MS)
    while (!this.destroyed && Date.now() < deadline) {
      try {
        const budget = Math.max(1, Math.min(GAME_BOOT.SCREENSHOT_TIMEOUT_MS, deadline - Date.now()))
        const frame: ImageData = await TimeoutHelper.withTimeout(() => this.dosCI.screenshot(), budget)
        const seen = BootStageHelper.classify(frame)
        if (seen === 'game') {
          console.log("Green check passed")
          console.log("jogo carregado")
          this.diagnostics.log('boot', 'game screen detected', () => ({ afterMs: Math.round(performance.now() - began) }))
          this.diagnostics.log('frame', 'guest framebuffer', () => ({ size: `${frame.width}x${frame.height}`, mode: DisplayModeHelper.fromFrameSize(frame.width, frame.height) }))
          return true
        }

        const next = BootStageHelper.advance(stage, seen)
        if (next !== stage) {
          stage = next
          this.diagnostics.log('boot', 'stage', () => ({ stage, size: `${frame.width}x${frame.height}`, afterMs: Math.round(performance.now() - began) }))
          onStatus?.(BootScreenHelper.fromStage(stage))
        }
      } catch (e) {
        console.warn("Error checking green screen", { reason: e })
      }
      console.log("aguardando o jogo carregar...")
      await pause(GAME_BOOT.DETECTION_POLL_MS)
    }

    this.diagnostics.log('boot', 'game screen not detected', () => ({ stage, destroyed: this.destroyed, afterMs: Math.round(performance.now() - began) }))
    return false
  }

  async loadConfig(gameDetected = true) {
    this.setupSmoothFilter()
    this.setupAutoSave()
    this.setupPeriodicSave()
    this.setupSpectatorCursors()
    this.setupSpectatorAudio()
    await this.setupTouchInput()
    this.syncFieldHint()
    await this.setupIdlePause()
    await this.setupPlatform()
    this.gameDetected = gameDetected
    this.startSafetyNets()
  }

  /**
   * The first-run coach, once. `hosted` is whether the person came to host and the room is now on the air (startRoomAskedForWhileBooting):
   * that visit has already done what it was for. The flag is the one the old welcome alert wrote (`HIDE_TUTORIAL`), so a player who
   * had answered that one has answered this one. An unreadable store counts as answered: a coach that cannot remember it was
   * shown would greet the person on every visit.
   */
  private async handleShowFirstRun(hosted: boolean) {
    let stored: unknown
    let readable = true
    try {
      stored = await this.storageService.get<boolean>(STORAGE_KEY.HIDE_TUTORIAL)
    } catch (e) {
      readable = false
      console.warn('Could not read whether the first-run coach was answered; not showing it', e)
    }
    if (FirstRunHelper.due({ stored, readable, gameSeen: true, hostedThisVisit: hosted })) {
      await this.showFirstRunCoach()
    }
  }

  /**
   * The first-run coach: tap, type, save and back up, in three cards. Reachable from the menu as "Primeiros passos" as well, so retiring
   * it is not a one-way door. Closing it any way is the answer: the flag is written when it goes, so "Pular" is as final as "Entendi".
   *
   * Resolves only once the person is done with it, because the caller carries on to the next thing the page may say (the nudges).
   */
  async showFirstRunCoach() {
    this.closeMenu()
    const modal = await this.modalController.create({
      component: FirstRunCoachComponent,
      componentProps: {
        touch: this.layoutHelperService.isTouchPrimary,
        help: (topic: HelpTopic) => { void this.openGuide(topic) },
      },
      cssClass: 'win9x-modal first-run-modal',
      backdropDismiss: false,
    })
    await modal.present()
    const { role } = await modal.onDidDismiss()
    this.diagnostics.log('page', 'first-run coach closed', () => ({ role }))
    try {
      await this.storageService.set(STORAGE_KEY.HIDE_TUTORIAL, true)
    } catch (e) {
      console.warn('Could not store that the first-run coach was answered', e)
    }
  }

  /**
   * The guide (FAQ and manual), opened at a topic when a "?" asked for one. The accordion that holds the topic is open and in view
   * when the window is. Resolves when the guide is closed, so callers can queue something after it.
   */
  async openGuide(topic?: HelpTopic) {
    this.closeMenu()
    const modal = await this.modalController.create({
      component: UserGuideComponent,
      componentProps: { topic },
      backdropDismiss: false
    })
    await modal.present()
    await modal.onDidDismiss()
  }

  async showAboutModal() {
    this.closeMenu()
    const modal = await this.modalController.create({
      component: AboutComponent,
      backdropDismiss: false
    })
    await modal.present()
  }

  /** The diagnostics window: switch, last lines, and the ways to get the report off the device. */
  async showDiagnosticsModal() {
    this.closeMenu()
    const modal = await this.modalController.create({
      component: DiagnosticsModalComponent,
      // The command interface is threaded through, as to every service: the report reads the
      // guest's framebuffer size off it.
      componentProps: { dosCI: this.dosCI },
      cssClass: 'win9x-modal diagnostics-modal',
      backdropDismiss: false
    })
    await modal.present()
  }

  async showOmaticModal() {
    this.closeMenu()
    const modal = await this.modalController.create({
      component: OmaticModalComponent,
      cssClass: 'omatic-modal',
      backdropDismiss: false
    })
    await modal.present()
  }

  /**
   * The deck's presentation as the deck takes it. The deck is not mounted for `none`, except on a landscape phone, whose
   * left rail is there with the deck's keys off (`keysShown`) and holds the menu and the room code.
   */
  get deckPresentation(): 'band' | 'launcher' | 'rails' {
    if (this.layout.kind === 'band') return 'band'
    return this.layout.rails ? 'rails' : 'launcher'
  }

  /** Columns of keys in each rail, from the stage plan; one and none until the row has been measured. */
  get stageLeftColumns(): 1 | 2 {
    return this.stagePlan?.leftColumns === 2 ? 2 : 1
  }

  get stageRightColumns(): 0 | 1 | 2 {
    const columns = this.stagePlan?.rightColumns ?? 0
    return columns === 2 ? 2 : columns === 1 ? 1 : 0
  }

  /** Keys are refused while the page is on its way out: the emulator is about to be exited. */
  get deckDisabled(): boolean {
    return this.leaving || this.destroyed
  }

  /**
   * Save now: the menu's "Salvar agora" and the toolbar chip. It asks the game first (see
   * SavePolicyHelper): the game's own save dialog being up is not the moment to copy the disk, and
   * the auto-saver takes the copy as soon as it closes, so the answer then is to say so.
   */
  async saveNow() {
    this.closeMenu()
    const result = await this.saveSafety.saveNow('manual')
    switch (result.outcome) {
      case 'saved':
        // Saved either way, but an unreadable look (auto-save off, the OCR still loading or down)
        // is not proof the game was not mid-write, and the toast does not pretend it was.
        if (result.verified) {
          await this.multiplayerUiService.showToast(`Jogo salvo no navegador às ${SaveStatusHelper.clock(result.at)}.`, 'success', 2500)
        } else {
          await this.multiplayerUiService.showToast(`Jogo salvo no navegador às ${SaveStatusHelper.clock(result.at)}, mas não foi possível confirmar se o Elifoot estava gravando.`, 'warning', 5000)
        }
        break
      case 'busy':
        await this.multiplayerUiService.showToast('O jogo está gravando agora. Ele será salvo no navegador logo em seguida.', 'warning', 4000)
        break
      case 'no-emulator':
        await this.multiplayerUiService.showToast('O jogo ainda está iniciando.', 'warning', 3000)
        break
      case 'failed':
        await this.showErrorAlert(new Error('Não foi possível salvar o jogo agora. Tente de novo em instantes.'))
        break
    }
  }

  /**
   * "Exportar jogos salvos". The backup is built first, behind a loader, and only then offered:
   * on a phone with a share sheet the choice is a button of its own, because Safari honours
   * `navigator.share()` only while the tap is the current user gesture and the zip takes longer
   * than a gesture lasts. A desktop, or a browser that cannot share a file, downloads at once.
   */
  async exportGameSaves() {
    this.closeMenu()
    if (await this.saveSafety.isGameWriting()) {
      await this.multiplayerUiService.showToast('O jogo está gravando agora. Tente exportar de novo em alguns segundos.', 'warning', 4000)
      return
    }

    const loading = await this.loadingController.create({
      message: 'Preparando o backup...',
      backdropDismiss: false
    })
    await loading.present()
    let backup: SavesBackup | null
    try {
      backup = await this.saveGameService.prepareSavesBackup(this.dosCI)
    } catch (e) {
      console.error('Could not build the backup', e)
      await loading.dismiss()
      await this.showErrorAlert(new Error('Não foi possível preparar o backup. Recarregue a página e tente novamente.'))
      return
    }
    await loading.dismiss()

    if (!backup) {
      const alert = await this.alertController.create({
        header: 'Aviso',
        message: 'Não há jogos salvos para baixar',
        backdropDismiss: false,
        cssClass: 'win9x-alert',
        buttons: ['OK']
      });
      await alert.present();
      return
    }

    const canShare = matchMedia('(pointer: coarse)').matches
      && SaveBackupHelper.canShareFile(navigator, this.saveGameService.backupFile(backup))
    if (!canShare) {
      await this.deliverBackup(backup, 'download')
      return
    }

    const ready = backup
    const kilobytes = Math.max(1, Math.round(ready.bytes.byteLength / 1024))
    const alert = await this.alertController.create({
      header: 'Backup pronto',
      message: `${ready.names.length === 1 ? '1 jogo salvo' : `${ready.names.length} jogos salvos`} (${kilobytes} KB). Escolha onde guardar o arquivo.`,
      cssClass: 'win9x-alert alert-whitespace',
      backdropDismiss: false,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        // Called from the tap itself, with nothing awaited before the share: see above.
        { text: 'Baixar arquivo', handler: () => { void this.deliverBackup(ready, 'download') } },
        { text: 'Compartilhar…', handler: () => { void this.deliverBackup(ready, 'share') } },
      ]
    })
    await alert.present()
  }

  private async deliverBackup(backup: SavesBackup, how: 'download' | 'share') {
    try {
      const delivery = await this.saveGameService.deliverBackup(backup, how)
      if (delivery === 'cancelled') return
      await this.multiplayerUiService.showToast(
        delivery === 'shared' ? 'Backup compartilhado.' : 'Backup baixado.', 'success', 3000)
    } catch (e) {
      console.error('Could not hand over the backup', e)
      await this.showErrorAlert(new Error('Não foi possível entregar o backup. Tente de novo.'))
    }
  }

  /**
   * A one-time reminder when a week has passed without a backup (SavePolicyHelper.backupNudgeDue).
   * A dialog, because it is asked once in the life of the install and has to be read: the first
   * version was a toast, and with two buttons beside the text Ionic squeezed the sentence into a
   * column a few words wide. Either button answers it for good; closing the page without pressing
   * one does not count, so it is still there next visit.
   */
  private async maybeNudgeBackup(): Promise<boolean> {
    try {
      if (this.destroyed || !(await this.saveStatus.backupNudgeDue())) return false
      // "Dos seus jogos salvos" has to be true: a visit that only looked around persists the layer
      // too, and a reminder answered with nothing to back up would be spent for good.
      if ((await this.patchService.existingSaveNames(this.dosCI)).length === 0) return false
      const alert = await this.alertController.create({
        header: 'Faça um backup',
        message: 'Já faz mais de 7 dias sem um backup dos seus jogos salvos. O navegador pode apagar os dados de sites que ficam muito tempo sem uso, e o backup é a cópia que sobrevive.\n\nExportar uma cópia agora?',
        backdropDismiss: false,
        cssClass: 'win9x-alert alert-whitespace',
        buttons: [
          { text: 'Agora não', role: 'cancel' },
          { text: 'Fazer backup', role: 'confirm' },
        ]
      })
      await alert.present()
      this.diagnostics.log('save', 'backup nudge shown')
      const { role } = await alert.onDidDismiss()
      this.saveStatus.dismissBackupNudge()
      if (role === 'confirm') await this.exportGameSaves()
      return true
    } catch (e) {
      console.warn('Could not show the backup reminder', e)
      return false
    }
  }

  /**
   * What the page may say once the first-run coach is out of the way, at most ONE thing per page load and each
   * of them once in the life of the install: the backup reminder, then the offer to install the app,
   * then the hint to turn the phone. The order is the order of what it protects, and it is this
   * sequence (NudgeHelper decides only whether each is due).
   */
  private async maybeNudge() {
    if (await this.maybeNudgeBackup()) return
    if (await this.maybeNudgeInstall()) return
    await this.maybeHintRotation()
  }

  /**
   * The one-time install banner: a toast with two buttons, never on a first visit (NudgeHelper.installDue:
   * an earlier session has to have saved something) and never again once it has been on screen. Either
   * button, or the toast running out, answers it for good; the menu entry stays as the permanent way.
   * The button calls the install prompt from its own tap, because the browser's prompt needs the tap's
   * user activation and the toast's dismissal is too late to carry it.
   */
  private async maybeNudgeInstall(): Promise<boolean> {
    try {
      if (this.destroyed || this.leaving) return false
      await this.saveStatus.load()
      const mode = this.install.mode
      const due = NudgeHelper.installDue({
        mode,
        dismissed: await this.nudges.answered('install'),
        firstPersistedAt: this.saveStatus.snapshot.firstPersistedAt,
        inRoom: this.multiplayerService.isInRoom,
      })
      if (!due || this.destroyed) return false

      const toast = await this.toastController.create({
        message: InstallHelper.bannerMessage(mode),
        cssClass: 'platform-toast',
        position: 'top',
        // Two buttons beside a sentence squeeze it into a column a few words wide; stacked puts them under it.
        layout: 'stacked',
        duration: PLATFORM_NUDGES.INSTALL_TOAST_MS,
        buttons: [
          { text: 'Agora não', role: 'cancel' },
          { text: mode === 'ios' ? 'Como instalar' : 'Instalar', role: 'confirm', handler: () => { void this.promptInstall() } },
        ],
      })
      this.nudgeToast = toast
      await toast.present()
      this.diagnostics.log('platform', 'nudge: install banner shown', () => ({ mode }))
      const { role } = await toast.onDidDismiss()
      if (this.nudgeToast === toast) this.nudgeToast = undefined
      this.diagnostics.log('platform', 'nudge: install banner closed', () => ({ role: role ?? 'timeout' }))
      await this.nudges.answer('install')
      return true
    } catch (e) {
      console.warn('Could not show the install banner', e)
      return false
    }
  }

  /**
   * The one-time "Gire o aparelho" hint, on a phone held upright (decision D4: a hint and a button,
   * no lock). It goes away by itself the moment the phone is turned, and is never shown again after
   * it was on screen.
   */
  private async maybeHintRotation(): Promise<boolean> {
    try {
      if (this.destroyed || this.leaving) return false
      const due = NudgeHelper.rotateDue({
        answered: await this.nudges.answered('rotate'),
        phoneInPortrait: FullscreenHelper.phoneInPortrait({ width: window.innerWidth, height: window.innerHeight }, this.layoutHelperService.isTouchPrimary),
        inRoom: this.multiplayerService.isInRoom,
      })
      if (!due || this.destroyed) return false

      const toast = await this.toastController.create({
        message: 'Gire o aparelho: deitado, o jogo fica bem maior na tela.',
        cssClass: 'platform-toast',
        position: 'top',
        duration: PLATFORM_NUDGES.ROTATE_TOAST_MS,
        buttons: [{ text: 'Entendi', role: 'cancel' }],
      })
      this.nudgeToast = toast
      const turned = this.layoutHelperService.shape$.pipe(filter(shape => shape !== 'portrait'), take(1))
        .subscribe(() => void toast.dismiss(undefined, 'turned'))
      this.pageSubscriptions.add(turned)
      await toast.present()
      this.diagnostics.log('platform', 'nudge: rotate hint shown')
      const { role } = await toast.onDidDismiss()
      turned.unsubscribe()
      if (this.nudgeToast === toast) this.nudgeToast = undefined
      this.diagnostics.log('platform', 'nudge: rotate hint closed', () => ({ role: role ?? 'timeout' }))
      await this.nudges.answer('rotate')
      return true
    } catch (e) {
      console.warn('Could not show the rotate hint', e)
      return false
    }
  }

  async downloadFullDiskChanges() {
    const hasSaved = await this.saveGameService.downloadFullDiskChanges(this.dosCI)
    this.closeMenu()
    if (!hasSaved) {
      const alert = await this.alertController.create({
        header: 'Aviso',
        message: 'Não há alterações no disco para baixar',
        backdropDismiss: false,
        cssClass: 'win9x-alert',
        buttons: ['OK']
      });
      await alert.present();
    }
  }

  /**
   * "Apagar todos os dados": two questions, because the wipe cannot be taken back. The first offers the backup (and says why), the
   * second needs a box ticked. See WipeFlowHelper for the words and the rule. Reached from "Dados e avançado", where it is the only
   * thing in the danger zone, and from the boot-failure dialog, where there is no emulator: the backup it offers is then the copy
   * read straight out of IndexedDB.
   */
  async confirmWipe() {
    const first = WipeFlowHelper.first()
    const ask = await this.alertController.create({
      header: first.header,
      message: first.message,
      backdropDismiss: false,
      cssClass: 'win9x-alert alert-whitespace',
      buttons: [
        { text: first.cancel, role: 'cancel' },
        {
          // Leaves the dialog up: the backup is one thing the person does on the way to the next question, and when it is done this
          // is where they are.
          text: first.backup,
          handler: () => {
            void this.backupBeforeWipe()
            return false
          }
        },
        { text: first.next, role: 'continue' },
      ]
    })
    await ask.present()
    const { role } = await ask.onDidDismiss()
    this.diagnostics.log('page', 'wipe: first question answered', () => ({ role }))
    if (role !== 'continue') return
    await this.confirmWipeLastStep()
  }

  private async backupBeforeWipe() {
    // With an emulator the backup is the saves, as everywhere else; without one (the boot failed) it is the disk copy read from IndexedDB.
    if (this.dosCI) await this.exportGameSaves()
    else await this.downloadStoredBackup()
  }

  private async confirmWipeLastStep() {
    const last = WipeFlowHelper.second()
    const alert = await this.alertController.create({
      header: last.header,
      message: last.message,
      backdropDismiss: false,
      cssClass: 'win9x-alert alert-whitespace',
      inputs: [{
        type: 'checkbox',
        label: last.checkbox,
        value: WipeFlowHelper.CONFIRM_VALUE,
        checked: false,
      }],
      buttons: [
        { text: last.cancel, role: 'cancel' },
        {
          text: last.confirm,
          cssClass: 'alert-danger',
          handler: async (values: unknown) => {
            if (!WipeFlowHelper.confirmed(values)) {
              // Nothing happens, and the dialog says why: a destructive button that does nothing silently reads as broken.
              alert.message = last.reminder
              return false
            }
            this.diagnostics.log('page', 'wipe: confirmed')
            await this.wipeEverything()
            return true
          }
        },
      ]
    })
    await alert.present()
  }

  /** The wipe itself, behind a loader; only `confirmWipeLastStep` calls it. */
  private async wipeEverything() {
    // show loading
    const loading = await this.loadingController.create({
      message: 'Apagando dados...',
      backdropDismiss: false
    })
    await loading.present()

    // Before anything is deleted. The auto-saver would persist the layer that is being
    // deleted, the page-hidden save would do it again when the reload fires `visibilitychange`,
    // and a status write that lands after the wipe would claim a save the disk no longer has.
    this.autoSaverService.stop()
    this.autoSaverService.stopPeriodicSave()
    this.stopSafetyNets()
    this.saveStatus.freeze()
    // The camera's debounced write of where it was left must not land after the wipe either: detaching flushes it now, before the storage is emptied.
    this.camera.detach('data wipe')

    // clear all data
    await this.saveGameService.clearAllData(this.dosCI)
    // Before the storage is emptied, not after: with the log still on, the reload below
    // fires pagehide, which writes the log's tail back into the storage that was just wiped.
    await this.diagnostics.disable({ persist: false })
    await this.storageService.clearAllData()
    await loading.dismiss()
    this.reloadPage()
  }

  /** Read the player's choice, or the default for one who never made it. An unreadable store is the default. */
  private async setupIdlePause() {
    try {
      this.idlePause = EmulatorPowerHelper.enabled(await this.storageService.get<boolean>(STORAGE_KEY.IDLE_PAUSE), EMULATOR_POWER.DEFAULT_ENABLED)
    } catch (e) {
      console.warn('Could not read the battery saver setting; using the default', e)
    }
  }

  /**
   * "Economizar bateria quando parado". Applies at once: turning it off wakes a sleeping guest.
   */
  async toggleIdlePause(e: any) {
    this.idlePause = !!e.detail.checked
    this.diagnostics.log('power', 'setting chosen', () => ({ on: this.idlePause }))
    this.syncIdlePause()
    try {
      await this.storageService.set<boolean>(STORAGE_KEY.IDLE_PAUSE, this.idlePause)
    } catch (error) {
      // It applies for this visit either way.
      console.warn('Could not store the battery saver setting', error)
    }
  }

  /**
   * The idle pause runs while the setting is on, the emulator is up and the safety nets are (it is
   * one of them, see stopSafetyNets), and not otherwise.
   */
  private syncIdlePause() {
    if (!this.idlePause || !this.netsUp || !this.dosCI || this.destroyed) {
      this.power.stop()
      return
    }
    this.power.start(this.dosCI, {
      isHosting: () => this.multiplayerService.isHosting || this.isHosting || this.isStreaming,
      gameDetected: () => this.gameDetected || this.exitWatcher.gameSeen,
      isBusy: () => this.emulatorControlService.pendingKeys > 0 || this.touchInputService.busy,
      isGameSaving: () => this.saveSafety.gameSavingVerdict(),
    })
  }

  /**
   * The platform's side of a phone: the screen lock, the game's sound and the fullscreen. Runs once the
   * game is up (loadConfig). Each read is its own try, because with site data blocked every Ionic
   * Storage read rejects while the game itself boots, and a setting nobody can read is its default.
   */
  private async setupPlatform() {
    const read = async <T>(key: string): Promise<T | undefined> => {
      try {
        return (await this.storageService.get<T>(key)) ?? undefined
      } catch (e) {
        console.warn(`Could not read ${key}; using the default`, e)
        return undefined
      }
    }
    this.keepAwake = WakeLockHelper.setting(await read<boolean>(STORAGE_KEY.KEEP_AWAKE))
    const volume = await read<number>(STORAGE_KEY.GAME_VOLUME)
    const muted = await read<boolean>(STORAGE_KEY.GAME_MUTED)
    this.volumePercent = GameVolumeHelper.toPercent(GameVolumeHelper.normalise(volume))
    this.gameMuted = muted === true
    this.audioPlayback = (await read<boolean>(STORAGE_KEY.AUDIO_PLAYBACK)) === true
    if (this.destroyed) return

    // A room (hosting) holds the screen whatever the switch says; refresh() is told when one opens or closes.
    this.wakeLock.start({ setting: this.keepAwake, inRoom: () => this.multiplayerService.isInRoom })
    this.fullscreen.start()
    this.audioHealth.start()
    // js-dos applied the volume it had kept at run(); this is the page's copy, the one a wipe erases. A player who
    // never touched the volume has neither, and js-dos is left alone (setVolume would write its entry for nothing).
    if (volume !== undefined || muted !== undefined) {
      this.audioHealth.applyVolume(GameVolumeHelper.fromPercent(this.volumePercent), this.gameMuted)
    }
    if (this.audioPlayback) this.audioHealth.setPlayback(true)
  }

  /**
   * The subtitle of the "Volume do jogo" entry. A host is told that the volume is theirs alone, and
   * what spectators get is decided by the other switch ("Enviar o som do jogo aos espectadores"), so
   * the line must not claim they still hear the game while that one is off.
   */
  get volumeSummary(): string {
    const label = GameVolumeHelper.label(GameVolumeHelper.fromPercent(this.volumePercent), this.gameMuted)
    if (!this.isStreaming) return label
    return this.spectatorAudioDisabled
      ? `${label} · só para você; o som da sala está desligado`
      : `${label} · só para você; quem assiste continua ouvindo`
  }

  get audioPlaybackSupported(): boolean {
    return this.audioHealth.playbackSupported
  }

  get wakeLockSupported(): boolean {
    return this.wakeLock.supported
  }

  /** The subtitle of "Manter a tela ligada": what the browser actually did. */
  get wakeLockSummary(): string {
    return this.wakeLock.summary
  }

  /** The subtitle of "Tela cheia". */
  get fullscreenSummary(): string {
    return this.fullscreen.summary
  }

  /** The "Instalar o app" entry, or null where there is nothing to install (installed, or no way to). */
  get installEntry(): { title: string; subtitle: string } | null {
    return InstallHelper.menuLabel(this.installMode)
  }

  /** "Manter a tela ligada". Applies at once; a room holds the screen anyway. */
  async toggleKeepAwake(e: any) {
    this.keepAwake = !!e.detail.checked
    this.wakeLock.setSetting(this.keepAwake)
    try {
      await this.storageService.set<boolean>(STORAGE_KEY.KEEP_AWAKE, this.keepAwake)
    } catch (error) {
      // It applies for this visit either way.
      console.warn('Could not store the keep-awake setting', error)
    }
  }

  /**
   * "Tela cheia". The request is made before anything is awaited and before the menu closes, because the
   * browser grants fullscreen only to the tap that asked (user activation).
   */
  async toggleFullscreen() {
    const pending = this.fullscreen.toggle()
    this.closeMenu()
    if (await pending === 'refused') {
      await this.multiplayerUiService.showToast('Não foi possível entrar em tela cheia neste navegador.', 'warning', 4000)
    }
  }

  /** The slider while it is dragged: heard at once, stored when it is let go (onVolumeChange). */
  onVolumeInput(e: any) {
    this.applyVolumeFromSlider(Number(e.detail.value))
  }

  async onVolumeChange(e: any) {
    this.applyVolumeFromSlider(Number(e.detail.value))
    await this.storeVolume()
  }

  /** "Silenciar o jogo": a gain of 0 on a running audio context, so it is never mistaken for a blocked one. */
  async toggleGameMuted(e: any) {
    const muted = !!e.detail.checked
    if (muted === this.gameMuted) return
    this.gameMuted = muted
    this.diagnostics.log('platform', 'audio: mute chosen', () => ({ muted }))
    this.audioHealth.applyVolume(GameVolumeHelper.fromPercent(this.volumePercent), this.gameMuted)
    await this.storeVolume()
  }

  /** "Som no modo silencioso". */
  async toggleAudioPlayback(e: any) {
    this.audioPlayback = !!e.detail.checked
    this.audioHealth.setPlayback(this.audioPlayback)
    try {
      await this.storageService.set<boolean>(STORAGE_KEY.AUDIO_PLAYBACK, this.audioPlayback)
    } catch (error) {
      console.warn('Could not store the silent-mode sound setting', error)
    }
  }

  private applyVolumeFromSlider(percent: number) {
    if (!Number.isFinite(percent)) return
    const next = GameVolumeHelper.afterSlider({ volume: GameVolumeHelper.fromPercent(this.volumePercent), muted: this.gameMuted }, percent)
    this.volumePercent = GameVolumeHelper.toPercent(next.volume)
    this.gameMuted = next.muted
    this.audioHealth.applyVolume(next.volume, next.muted)
  }

  private async storeVolume() {
    try {
      await this.storageService.set<number>(STORAGE_KEY.GAME_VOLUME, GameVolumeHelper.fromPercent(this.volumePercent))
      await this.storageService.set<boolean>(STORAGE_KEY.GAME_MUTED, this.gameMuted)
    } catch (error) {
      // It applies for this visit either way.
      console.warn('Could not store the volume', error)
    }
  }

  /**
   * "Instalar o app": the browser's own prompt where there is one, the how-to dialog on iOS, where the
   * share sheet is the only way. Called from a tap, and the prompt is asked before anything is awaited.
   */
  async promptInstall() {
    this.closeMenu()
    if (this.install.mode === 'prompt') {
      const outcome = await this.install.prompt()
      if (outcome === 'accepted') {
        await this.multiplayerUiService.showToast('Instalando o Elifoot 98…', 'success', 3000)
      }
    } else if (this.install.mode === 'ios') {
      await this.showInstallHowTo()
    }
  }

  /**
   * iOS has no install prompt. The steps are the short part; the warning is the one that matters: an
   * app on the Home Screen keeps its own storage, apart from Safari's, so the saves made here are not in
   * it. The way across is the backup, one button away.
   */
  private async showInstallHowTo() {
    const howTo = InstallHelper.iosHowTo()
    const alert = await this.alertController.create({
      header: howTo.header,
      message: howTo.message,
      cssClass: 'win9x-alert alert-whitespace wide-alert',
      backdropDismiss: false,
      buttons: [
        { text: 'Fechar', role: 'cancel' },
        { text: 'Exportar jogos salvos', role: 'export' },
      ],
    })
    await alert.present()
    const { role } = await alert.onDidDismiss()
    this.diagnostics.log('platform', 'install: how-to answered', () => ({ role: role ?? 'dismissed' }))
    if (role === 'export') await this.exportGameSaves()
  }

  /** Read "Salvar ao gravar o jogo" (stored as the OFF flag it always was) and put the auto-saver in step. Writes nothing. */
  async setupAutoSave() {
    this.applyAutoSaveOnGame(InvertedSettingHelper.isOn(await this.storageService.get<boolean>(STORAGE_KEY.DISABLE_AUTO_SAVE)))
  }

  /** "Salvar ao gravar o jogo". Applies at once and is kept as the OFF flag, so an upgrade keeps what the player chose. */
  async setAutoSaveOnGame(on: boolean) {
    this.applyAutoSaveOnGame(on)
    await this.storageService.set<boolean>(STORAGE_KEY.DISABLE_AUTO_SAVE, InvertedSettingHelper.toStored(on))
  }

  private applyAutoSaveOnGame(on: boolean) {
    this.autoSaveOnGame = on
    console.log(`autosave: ${on ? 'on' : 'off'}`)

    if (on) {
      // A hosting browser keeps playing, and streaming, from a hidden tab, so its ticks go on.
      this.autoSaverService.start(this.dosCI, {
        keepRunningWhileHidden: () => this.multiplayerService.isHosting,
      })
    } else {
      this.autoSaverService.stop()
    }
  }

  async setupPeriodicSave() {
    const periodicSave = await this.storageService.get<boolean>(STORAGE_KEY.PERIODIC_SAVE)
    if (periodicSave) {
      this.togglePeriodicSave({ detail: { checked: periodicSave } })
    }
  }

  async togglePeriodicSave(e: any) {
    const checked = e.detail.checked
    this.periodicSave = checked
    await this.storageService.set<boolean>(STORAGE_KEY.PERIODIC_SAVE, this.periodicSave)
    if (checked) {
      this.autoSaverService.startPeriodicSave()
    } else {
      this.autoSaverService.stopPeriodicSave()
    }
  }

  /** Read "Suavizar a imagem" (stored as the OFF flag it always was) and put the canvas in step. Writes nothing. */
  async setupSmoothFilter() {
    this.applySmoothing(InvertedSettingHelper.isOn(await this.storageService.get<boolean>(STORAGE_KEY.DISABLE_SMOOTH_FILTER)))
  }

  /** "Suavizar a imagem". Applies at once and is kept as the OFF flag, so an upgrade keeps what the player chose. */
  async setSmoothing(on: boolean) {
    this.applySmoothing(on)
    await this.storageService.set<boolean>(STORAGE_KEY.DISABLE_SMOOTH_FILTER, InvertedSettingHelper.toStored(on))
  }

  private applySmoothing(on: boolean) {
    this.smoothing = on
    console.log(`smooth filter: ${on ? 'on' : 'off'}`)
    const canvas = document.getElementsByClassName('emulator-canvas')[0] as HTMLCanvasElement | undefined
    canvas?.classList.toggle('smooth-canvas', on)
  }

  async setupSpectatorCursors() {
    const hidden = await this.storageService.get<boolean>(STORAGE_KEY.HIDE_SPECTATOR_CURSORS)
    this.spectatorCursorsHidden = !!hidden
  }

  async setupSpectatorAudio() {
    const disabled = await this.storageService.get<boolean>(STORAGE_KEY.DISABLE_SPECTATOR_AUDIO)
    this.spectatorAudioDisabled = !InvertedSettingHelper.isOn(disabled)
  }

  /**
   * Stop or resume sending the game's sound to spectators, live.
   *
   * Only flips the track's `enabled`, so the room is not renegotiated and a spectator who
   * joins later gets the same track as one who was there from the start. The spectators are
   * not told: they hear silence, exactly as they would from a quiet game.
   */
  async toggleSpectatorAudio(e: any) {
    // The toggle reads "send the sound"; the stored flag is its negation, so that an absent
    // key (every existing install) means the default, which is to send it.
    this.spectatorAudioDisabled = !e.detail.checked
    this.multiplayerAudioService.setEnabled(!this.spectatorAudioDisabled)
    await this.storageService.set<boolean>(STORAGE_KEY.DISABLE_SPECTATOR_AUDIO, InvertedSettingHelper.toStored(!this.spectatorAudioDisabled))
  }

  /**
   * Hide or restore every spectator cursor, name and click ping on the game surface.
   *
   * Purely local, and deliberately silent: the guests are not told, because there is
   * nothing for them to do about it. It is the host's escape hatch for the case the
   * password cannot cover — a code that got shared further than intended, and enough
   * pointers parked on the game to be in the way. Idle labels already bound how much of
   * the canvas that can cover; this covers the rest without needing a kick, which is a
   * moderation feature the multiplayer study deliberately left out of scope.
   */
  async toggleSpectatorCursors(e: any) {
    this.spectatorCursorsHidden = e.detail.checked
    await this.storageService.set<boolean>(STORAGE_KEY.HIDE_SPECTATOR_CURSORS, this.spectatorCursorsHidden)
    // Repaint from the last known positions rather than waiting for movement.
    this.renderCursors(this.latestCursors)
  }

  /**
   * The video mode the guest is drawing now, read off its framebuffer on every call and never kept:
   * the flag in the saved disk only says what the next boot will do. `null` when the frame is
   * neither size (the guest is at the DOS prompt after Windows exited).
   */
  get currentDisplayMode(): DisplayMode | null {
    if (!this.dosCI) return null
    return DisplayModeHelper.fromFrameSize(this.dosCI.width(), this.dosCI.height())
  }

  /** The subtitle of the "Resolução do jogo" entry. */
  get displayModeSummary(): string {
    // The entry is disabled in a room, and a disabled entry should say why.
    if (this.isStreaming) return 'Encerre a sala para trocar'
    const mode = this.currentDisplayMode
    return mode ? DisplayModeHelper.label(mode) : 'Toque para escolher'
  }

  /**
   * Pick the guest's resolution: 640x480 (the default) or 800x600. The mode is fixed when the
   * guest boots, so a change is a reload, which ends a room for every spectator; the menu entry is
   * disabled while one is live and this refuses on its own for any other way in.
   */
  async promptDisplayMode() {
    this.closeMenu()
    if (this.isStreaming || this.isHosting) return

    const current = this.currentDisplayMode
    let chosen: DisplayMode | undefined
    const alert = await this.alertController.create({
      header: 'Resolução do jogo',
      cssClass: 'win9x-alert alert-whitespace wide-alert',
      // Honest about the trade (the canvas box does not change, so on a desktop the same picture
      // is magnified more at 640x480: larger and softer, not larger and as sharp) and one short
      // paragraph: on a landscape phone (~390px tall) anything longer pushes the radios and the
      // buttons out of view, and the FAQ carries the full explanation.
      message:
        'Trocar a resolução reinicia o jogo. ' +
        'No computador, 640x480 deixa o texto maior, porém mais suave.',
      inputs: DisplayModeHelper.modes().map(mode => ({
        type: 'radio' as const,
        label: DisplayModeHelper.label(mode),
        value: mode,
        checked: mode === current,
      })),
      buttons: [{
        text: 'Cancelar',
        role: 'cancel'
      }, {
        text: 'Continuar',
        handler: (value: DisplayMode | undefined) => {
          chosen = value
        }
      }]
    })
    await alert.present()
    await alert.onDidDismiss()

    // Nothing to do for the mode it is already in, or for no choice at all.
    if (!chosen || chosen === current) return
    await this.confirmDisplayMode(chosen)
  }

  private async confirmDisplayMode(mode: DisplayMode) {
    const alert = await this.alertController.create({
      header: 'Reiniciar o jogo?',
      message: `O jogo será reiniciado em ${DisplayModeHelper.label(mode)}.\n\nOs jogos já gravados são mantidos, mas o que você não salvou dentro do próprio jogo será perdido.`,
      cssClass: 'win9x-alert alert-whitespace',
      backdropDismiss: false,
      buttons: [{
        text: 'Cancelar',
        role: 'cancel'
      }, {
        text: 'Reiniciar',
        handler: async () => {
          await this.applyDisplayMode(mode)
        }
      }]
    })
    await alert.present()
  }

  /**
   * Write the choice into the saved disk and reload into it. Like a patch, this replaces what
   * `layers.save()` persists with the edited layer, so the auto-saver is stopped first and the
   * emulator is not played on afterwards.
   */
  private async applyDisplayMode(mode: DisplayMode) {
    if (this.isStreaming || this.isHosting) return

    this.autoSaverService.stop()
    this.autoSaverService.stopPeriodicSave()
    this.stopSafetyNets()

    const loading = await this.loadingController.create({
      message: 'Trocando a resolução…',
      backdropDismiss: false
    })
    await loading.present()
    try {
      await this.patchService.setDisplayMode(this.dosCI, mode)
    } catch (e: any) {
      console.error(e)
      await loading.dismiss()
      // Nothing was written, so the game goes on as it was, with its saving back on.
      await this.restoreSaving()
      await this.showErrorAlert(e instanceof Error ? e : new Error(String(e)))
      return
    }

    try {
      await TimeoutHelper.withTimeout(() => this.dosCI.exit(), DISPLAY_MODE.EXIT_TIMEOUT_MS)
    } catch (e) {
      // The layer is written; a guest that will not stop must not hold the reload back.
      console.warn('The emulator did not exit cleanly before the reload', e)
    }
    this.reloadPage()
  }

  /**
   * Install direct touch on the booted emulator, or leave stock js-dos in charge when the person
   * chose the classic touchpad. Runs once the game is up (loadConfig), after the stored choice
   * is read.
   */
  async setupTouchInput() {
    // Not allowed to throw past applyTouchMode: with site data blocked the read rejects while the
    // game itself boots, and the layer is the only way some devices (a default-UA iPad) can touch
    // it at all. An unreadable choice is the default.
    let stored: string | undefined
    try {
      stored = await this.storageService.get<string>(STORAGE_KEY.TOUCH_MODE)
    } catch (e) {
      console.warn('Could not read the touch mode; using direct touch', e)
      this.diagnostics.log('touch', 'touch mode unreadable', () => ({ error: String(e) }))
    }
    this.touchMode = TouchModeHelper.normalise(stored)
    this.applyTouchMode()
  }

  /**
   * Put the layer in step with the choice. Nothing reloads: classic is simply "the layer is not
   * installed", so js-dos's own handlers, which are always bound, take the finger. The choice
   * that is stored can be a mode this device cannot run (the same browser asked for its "desktop
   * site" turns a phone into a user agent js-dos gives no touch to), and then it is direct.
   */
  private applyTouchMode() {
    if (this.destroyed) return
    const effective = TouchModeHelper.effective(this.touchMode, navigator.userAgent)
    if (effective === 'classic') {
      this.touchInputService.detach('classic mode')
      return
    }

    const layers = dosInstance?.layers
    if (!layers?.root || !layers.mouseOverlay || !layers.canvas) {
      // Stock js-dos keeps the finger, as it always did.
      console.warn('The emulator has no input layers to attach direct touch to.')
      this.diagnostics.log('touch', 'no input layers to attach to')
      return
    }
    this.touchInputService.attach(this.dosCI, {
      root: layers.root,
      overlay: layers.mouseOverlay,
      canvas: layers.canvas,
      // The clip around the picture, which the camera can make bigger than it, and the camera itself (two fingers; a click is followed).
      stage: this.stageElement(),
      camera: this.camera,
      // A tap on the game's own field must not close the OS keyboard the live type bar has open, and
      // the tap moves the guest on from whatever the bar was describing (see onGameTouched).
      keepFocus: () => this.typeBar?.onGameTouched() ?? false,
      // The layer's timers send after the finger has gone; a sleeping guest is woken before each.
      beforeSend: () => this.power.wake('touch'),
    })
  }

  /** The clip around the picture, `.game-stream-container`: the camera's view, and where the touch layer listens when it can be bigger than the picture. */
  private stageElement(): HTMLElement | undefined {
    return document.querySelector<HTMLElement>('.game-stream-container') ?? undefined
  }

  /**
   * Read the camera's setting and where it was left, and put it on the picture. Runs once the game is up AND shown (bootGame): the
   * camera works from the picture's box, and a game that is still hidden has none. Each read is its own try, like the platform's,
   * because with site data blocked every Ionic Storage read rejects while the game itself boots.
   */
  private async setupCamera() {
    let stored: boolean | undefined
    let views: unknown
    try {
      stored = (await this.storageService.get<boolean>(STORAGE_KEY.CAMERA_ENABLED)) ?? undefined
      views = await this.storageService.get<unknown>(STORAGE_KEY.CAMERA_VIEWS)
    } catch (e) {
      console.warn('Could not read the camera settings; using the defaults', e)
    }
    if (this.destroyed) return
    this.cameraEnabled = ViewportTransform.enabled(stored, this.layoutHelperService.isTouchPrimary)
    this.camera.configure(this.cameraEnabled, views)
    const layers = dosInstance?.layers
    const stage = this.stageElement()
    if (!layers?.root || !layers.canvas || !stage) {
      console.warn('The emulator has no picture to put the camera on.')
      return
    }
    const surface: CameraSurface = {
      stage,
      root: layers.root,
      canvas: layers.canvas,
      frame: () => ({ width: this.dosCI.width(), height: this.dosCI.height() }),
    }
    // Every gesture and button of the camera counts as the player being there, for the battery saver.
    this.camera.attach(surface, { activity: () => this.power.wake('camera') })
  }

  /**
   * The picture is magnified and the camera may take the free band under it: a portrait page whose band holds nothing but its
   * taskbar (no panel of keys, no chat). The picture's own box never depends on this; see global.scss `.camera-tall`.
   */
  get cameraTall(): boolean {
    return ViewportTransform.tallView({
      zoomed: this.cameraView.zoomed,
      shape: this.layout.shape,
      chatOpen: this.isChatOpen,
      deck: this.layout.kind,
      panel: this.layout.kind === 'band' ? this.deckShown : null,
    })
  }

  /** "Zoom e movimento". Applies at once: off puts the picture back as it was, and the camera that was left is kept for when it is on again. */
  async toggleCamera(e: any) {
    this.cameraEnabled = !!e.detail.checked
    this.camera.setEnabled(this.cameraEnabled)
    this.diagnostics.log('touch', 'camera setting chosen', () => ({ on: this.cameraEnabled }))
    try {
      await this.storageService.set<boolean>(STORAGE_KEY.CAMERA_ENABLED, this.cameraEnabled)
    } catch (error) {
      // It applies for this visit either way.
      console.warn('Could not store the camera setting', error)
    }
    if (this.cameraEnabled) {
      // At the top, like the live keyboard's: the bottom is where the Zoom tab it mentions is. The buttons are in the menu as well as in
      // the deck's tab, so the key panel being off no longer leaves a pinch as the only way in.
      const toast = await this.toastController.create({
        message: 'Zoom ligado. Pince com dois dedos na imagem, ou use o Zoom do menu ⋮ (Exibição).',
        duration: 4000,
        position: 'top',
        color: 'success',
      })
      await toast.present()
    }
  }

  /** The subtitle of the "Modo de toque" entry. */
  get touchModeSummary(): string {
    return TouchModeHelper.label(TouchModeHelper.effective(this.touchMode, navigator.userAgent))
  }

  /** Direct (a tap lands under the finger) or classic (js-dos's touchpad). Applies at once. */
  async promptTouchMode() {
    this.closeMenu()

    const current = TouchModeHelper.effective(this.touchMode, navigator.userAgent)
    let chosen: TouchMode | undefined
    const alert = await this.alertController.create({
      header: 'Modo de toque',
      cssClass: 'win9x-alert alert-whitespace wide-alert',
      // Short on purpose: on a landscape phone anything longer pushes the radios out of view.
      message:
        'Direto: o toque clica onde o dedo está.\n' +
        'Touchpad: o dedo move o cursor, como em um notebook.',
      inputs: TouchModeHelper.modes().map(mode => ({
        type: 'radio' as const,
        label: TouchModeHelper.label(mode),
        value: mode,
        checked: mode === current,
      })),
      buttons: [{
        text: 'Cancelar',
        role: 'cancel'
      }, {
        text: 'Aplicar',
        handler: (value: TouchMode | undefined) => {
          chosen = value
        }
      }]
    })
    await alert.present()
    await alert.onDidDismiss()

    if (!chosen || chosen === current) return
    this.touchMode = chosen
    this.diagnostics.log('touch', 'mode chosen', () => ({ mode: chosen }))
    this.applyTouchMode()
    try {
      await this.storageService.set<string>(STORAGE_KEY.TOUCH_MODE, chosen)
    } catch (e) {
      // It applies for this visit either way.
      console.warn('Could not store the touch mode', e)
    }
    await this.multiplayerUiService.showToast(`Modo de toque: ${TouchModeHelper.label(chosen)}.`, 'success', 3000)
  }

  /**
   * The control deck's two settings. Read before the boot (see ngOnInit); a storage that cannot be
   * read leaves the defaults, which show the deck where a finger is the primary pointer.
   */
  private async setupDeck() {
    try {
      this.applyDeckSetting(DeckLayoutHelper.normalise(await this.storageService.get<string>(STORAGE_KEY.DECK_MODE)))
      this.keyVibration = InvertedSettingHelper.isOn(await this.storageService.get<boolean>(STORAGE_KEY.DISABLE_KEY_VIBRATION))
      this.liveKeyboard = !!(await this.storageService.get<boolean>(STORAGE_KEY.LIVE_KEYBOARD))
      this.applyStageView(StageHelper.normaliseView(await this.storageService.get<string>(STORAGE_KEY.STAGE_VIEW)))
    } catch (e) {
      console.warn('Could not read the key panel settings; using the defaults', e)
    }
  }

  private applyStageView(view: StageView) {
    this.stageView = view
    this.stageLayout.setView(view)
  }

  /** The subtitle of the "Tamanho da imagem" entry: the choice. */
  get stageViewSummary(): string {
    return StageHelper.labelView(this.stageView)
  }

  /**
   * "Tamanho da imagem": Ajustar or Ampliar. Only a landscape phone has rails to change (the entry is offered there), and
   * the picture box changes only when the player flips it: nothing else moves it between the two.
   */
  async promptStageView() {
    this.closeMenu()

    const current = this.stageView
    let chosen: StageView | undefined
    const alert = await this.alertController.create({
      header: 'Tamanho da imagem',
      cssClass: 'win9x-alert alert-whitespace wide-alert',
      // Short on purpose, like the key panel's: on a landscape phone anything longer pushes the radios out of view. It says
      // what the choice is NOT, because "Ampliar" reads as a bigger picture and measured on every landscape phone it is not.
      message: 'A imagem fica do mesmo tamanho nas duas: muda só quantas colunas de teclas as laterais usam.',
      inputs: StageHelper.views().map(view => ({
        type: 'radio' as const,
        label: StageHelper.describeView(view),
        value: view,
        checked: view === current,
      })),
      buttons: [{
        text: 'Cancelar',
        role: 'cancel'
      }, {
        text: 'Aplicar',
        handler: (value: StageView | undefined) => {
          chosen = value
        }
      }]
    })
    await alert.present()
    await alert.onDidDismiss()

    if (!chosen || chosen === current) return
    this.diagnostics.log('page', 'stage view chosen', () => ({ view: chosen }))
    this.applyStageView(chosen)
    try {
      await this.storageService.set<string>(STORAGE_KEY.STAGE_VIEW, chosen)
    } catch (e) {
      // It applies for this visit either way.
      console.warn('Could not store the picture size setting', e)
    }
  }

  private applyDeckSetting(setting: DeckSetting) {
    this.deckSetting = setting
    this.deckSetting$.next(setting)
  }

  /** The subtitle of the "Painel de teclas" entry: the choice, and what the automatic one comes to here. */
  get deckSummary(): string {
    const shown = this.layout.kind !== 'none'
    if (this.deckSetting !== 'auto') return DeckLayoutHelper.label(this.deckSetting)
    // A touch screen that is not the primary pointer (a laptop's) is the case that needs the words.
    if (!shown && this.anyCoarse) return 'Automático · oculto (o mouse é o ponteiro principal)'
    return `Automático · ${shown ? 'aparece' : 'oculto'} neste aparelho`
  }

  /** "Painel de teclas": show it, hide it, or let the device decide. Applies at once. */
  async promptDeckMode() {
    this.closeMenu()

    const current = this.deckSetting
    let chosen: DeckSetting | undefined
    const alert = await this.alertController.create({
      header: 'Painel de teclas',
      cssClass: 'win9x-alert alert-whitespace wide-alert',
      // Short on purpose, like the touch mode's: on a landscape phone anything longer pushes the radios out of view.
      message: DeckLayoutHelper.describe('auto'),
      inputs: DeckLayoutHelper.settings().map(setting => ({
        type: 'radio' as const,
        label: DeckLayoutHelper.label(setting),
        value: setting,
        checked: setting === current,
      })),
      buttons: [{
        text: 'Cancelar',
        role: 'cancel'
      }, {
        text: 'Aplicar',
        handler: (value: DeckSetting | undefined) => {
          chosen = value
        }
      }]
    })
    await alert.present()
    await alert.onDidDismiss()

    if (!chosen || chosen === current) return
    this.diagnostics.log('page', 'deck setting chosen', () => ({ setting: chosen }))
    this.applyDeckSetting(chosen)
    try {
      await this.storageService.set<string>(STORAGE_KEY.DECK_MODE, chosen)
    } catch (e) {
      // It applies for this visit either way.
      console.warn('Could not store the key panel setting', e)
    }
  }

  /** "Vibração nas teclas". Stored as the OFF flag, so that an absent key (every existing install) means on. */
  async toggleKeyVibration(e: any) {
    this.keyVibration = !!e.detail.checked
    try {
      await this.storageService.set<boolean>(STORAGE_KEY.DISABLE_KEY_VIBRATION, InvertedSettingHelper.toStored(this.keyVibration))
    } catch (error) {
      console.warn('Could not store the key vibration setting', error)
    }
  }

  /**
   * "Teclado ao vivo (experimental)". Off, Texto opens the compose dialog as it always did. On, it
   * opens the live type bar, and the field hint (the Texto button's pulse, the bar's badge) starts
   * to watch the guest. Turning it off closes the bar and stops the watching.
   */
  async toggleLiveKeyboard(e: any) {
    this.liveKeyboard = !!e.detail.checked
    this.diagnostics.log('ime', 'live keyboard setting', () => ({ on: this.liveKeyboard }))
    if (!this.liveKeyboard) this.typeBar?.close()
    this.syncFieldHint()
    try {
      await this.storageService.set<boolean>(STORAGE_KEY.LIVE_KEYBOARD, this.liveKeyboard)
    } catch (error) {
      // It applies for this visit either way.
      console.warn('Could not store the live keyboard setting', error)
    }
    if (this.liveKeyboard) {
      // At the top: the bottom is where the Texto button it mentions is.
      const toast = await this.toastController.create({
        message: 'Teclado ao vivo ligado. Toque em Texto, no painel de teclas.',
        duration: 3500,
        position: 'top',
        color: 'success',
      })
      await toast.present()
    }
  }

  /** The field hint watches the guest while the live keyboard is on and there is an emulator, and not otherwise. */
  private syncFieldHint() {
    if (this.liveKeyboard && this.dosCI && !this.destroyed) {
      this.fieldHintService.start(this.dosCI)
    } else {
      this.fieldHintService.stop()
    }
  }

  /**
   * The deck's Texto button. With the live keyboard on it opens the type bar, in this very call: the
   * bar renders and focuses its field synchronously, which iOS requires of a keyboard that opens.
   * With it off, or where the bar is not mounted, it is the compose dialog.
   */
  onTextRequest() {
    if (!this.liveKeyboard || !this.typeBar) {
      void this.promptInputText()
      return
    }
    // One text surface at a time: the chat has a field of its own.
    this.toggleChat(false)
    this.typeBar.open()
  }

  showTypeBarNotice(notice: TypeBarNotice) {
    void this.multiplayerUiService.showToast(notice.message, notice.color, 4000)
  }

  /** The launcher's button (in the toolbar), and the rails' "Teclas" key is the dock's own. */
  toggleDeckSheet() {
    this.deckSheetOpen = !this.deckSheetOpen
    this.diagnostics.log('page', 'deck sheet', () => ({ open: this.deckSheetOpen }))
  }

  /**
   * The options menu: a bottom sheet where a finger is the pointer, the popover anchored to the button where a mouse is
   * (MenuHelper.presentation). Both draw the same sections (`menuSections`), and the sheet is an overlay of the app, so opening it moves
   * nothing in the page: the picture's box is the same with it open and closed (CLAUDE.md, *The stage*).
   */
  openMenu(e?: Event) {
    if (MenuHelper.presentation(this.layoutHelperService.isTouchPrimary) === 'sheet') {
      this.sheetInitialBreakpoint = MenuHelper.initialBreakpoint(this.layout.shape)
      this.isSheetOpen = true
      this.diagnostics.log('page', 'menu opened', () => ({ presentation: 'sheet', shape: this.layout.shape }))
      return
    }
    this.popover.event = null
    this.popover.event = e;
    this.closeMenu()
    this.diagnostics.log('page', 'menu opened', () => ({ presentation: 'popover' }))
    setTimeout(() => {
      this.isPopoverOpen = true;
    }, 50);
  }

  /**
   * The sections of the menu, as MenuHelper makes them from what the page knows. Rebuilt only when that changes, by content: a new array
   * from every change-detection pass would be a new identity for the template to compare, and a dev-mode NG0100.
   */
  get menuSections(): MenuSection[] {
    const context = this.menuContext()
    const key = JSON.stringify(context)
    if (key !== this.menuKey) {
      this.menuKey = key
      this.menuCache = MenuHelper.sections(context)
    }
    return this.menuCache
  }

  private menuContext(): MenuContext {
    const camera = this.cameraView
    return {
      inRoom: this.isStreaming,
      hostStarting: this.isHosting,
      unreadMessages: this.unreadMessages,
      fullscreenSupported: this.fullscreenSupported,
      install: this.installEntry,
      touchModeOffered: this.touchModeOffered,
      canVibrate: this.canVibrate,
      wakeLockSupported: this.wakeLockSupported,
      silentModeSupported: this.audioPlaybackSupported,
      railsOffered: this.layout.rails,
      camera: { on: camera.enabled, label: camera.label, zoomed: camera.zoomed, canZoomIn: camera.canZoomIn, canZoomOut: camera.canZoomOut },
      smoothing: this.smoothing,
      keyVibration: this.keyVibration,
      keepAwake: this.keepAwake,
      gameMuted: this.gameMuted,
      audioPlayback: this.audioPlayback,
      volumePercent: this.volumePercent,
      hideSpectatorCursors: this.spectatorCursorsHidden,
      sendSoundToSpectators: !this.spectatorAudioDisabled,
      fullscreenActive: this.fullscreenActive,
      summary: {
        save: this.saveSummary,
        volume: this.volumeSummary,
        room: `${this.hostRoomId} · ${this.participantCount || 1} na sala`,
        touchMode: this.touchModeSummary,
        deck: this.deckSummary,
        resolution: this.displayModeSummary,
        stageView: this.stageViewSummary,
        fullscreen: this.fullscreenSummary,
        keepAwake: this.wakeLockSummary,
      },
    }
  }

  /**
   * A row of the menu was pressed. An action closes the menu (it opens a dialog or a window, or leaves); a switch, the slider and the zoom
   * keys change a setting where it stands and leave it open, because the person is usually about to change the next one. The handlers
   * close the menu themselves where they need to: the fullscreen's and the install prompt's requests must be made before anything is
   * awaited, inside the tap, and the switch statement below calls them synchronously for that reason.
   */
  onMenuAction(event: MenuEvent): void | Promise<void> {
    switch (event.id) {
      case 'save-now': return this.saveNow()
      case 'data': return this.showAdvancedModal()
      case 'volume':
        return event.phase === 'change'
          ? this.onVolumeChange({ detail: { value: event.value } })
          : this.onVolumeInput({ detail: { value: event.value } })
      case 'mute': return this.toggleGameMuted({ detail: { checked: event.value } })
      case 'silent-mode': return this.toggleAudioPlayback({ detail: { checked: event.value } })
      case 'reload': return this.confirmRefresh()
      case 'leave': return this.confirmLeaveGame()
      case 'host': return this.promptHostRoom()
      case 'room': return this.openMultiplayerPanel()
      case 'hide-cursors': return this.toggleSpectatorCursors({ detail: { checked: event.value } })
      case 'send-sound': return this.toggleSpectatorAudio({ detail: { checked: event.value } })
      case 'type-text': this.closeMenu(); return this.promptInputText()
      case 'touch-mode': return this.promptTouchMode()
      case 'deck-mode': return this.promptDeckMode()
      case 'key-vibration': return this.toggleKeyVibration({ detail: { checked: event.value } })
      case 'smoothing': return this.setSmoothing(!!event.value)
      case 'fullscreen': return this.toggleFullscreen()
      case 'install': return this.promptInstall()
      case 'resolution': return this.promptDisplayMode()
      case 'stage-view': return this.promptStageView()
      case 'zoom': this.zoomFromMenu(event.zoom); return
      case 'keep-awake': return this.toggleKeepAwake({ detail: { checked: event.value } })
      case 'first-steps': return this.showFirstRunCoach()
      case 'guide': return this.openGuide()
      case 'about': return this.showAboutModal()
    }
  }

  /** The menu's Zoom row: the same effects as the deck's tab, reachable with the key panel off. */
  private zoomFromMenu(zoom: MenuEvent['zoom']) {
    switch (zoom) {
      case 'fit': this.camera.fit(); break
      case 'in': this.camera.zoomStep(1); break
      case 'out': this.camera.zoomStep(-1); break
    }
  }

  /** "Dados e avançado": backup, patches, the O Matic and the rest of what is not needed on most visits, and the wipe. */
  async showAdvancedModal() {
    this.closeMenu()
    const modal = await this.modalController.create({
      component: AdvancedModalComponent,
      componentProps: { host: this.advancedHost() },
      cssClass: 'win9x-modal advanced-modal',
      backdropDismiss: false,
    })
    await modal.present()
  }

  private advancedHost(): AdvancedHost {
    return {
      context: {
        inRoom: this.isStreaming || this.isHosting,
        debug: this.debugMode,
        cameraOffered: this.cameraOffered,
        values: {
          autosaveGame: this.autoSaveOnGame,
          autosavePeriodic: this.periodicSave,
          liveKeyboard: this.liveKeyboard,
          idlePause: this.idlePause,
          camera: this.cameraEnabled,
        },
        idleSeconds: this.idleSeconds,
      },
      handle: event => this.onAdvancedAction(event),
      help: topic => { void this.openGuide(topic) },
    }
  }

  /**
   * A row of "Dados e avançado". Called with the tap's own call stack: the two file pickers below open only from the gesture that asked
   * for them, so nothing is awaited before them.
   */
  private onAdvancedAction(event: AdvancedEvent): void | Promise<void> {
    switch (event.id) {
      case 'storage': return
      case 'export': return this.exportGameSaves()
      case 'import': this.saveGameFileInput.nativeElement.click(); return
      case 'autosave-game': return this.setAutoSaveOnGame(!!event.value)
      case 'autosave-periodic': return this.togglePeriodicSave({ detail: { checked: !!event.value } })
      case 'patch-load': this.patchFileInput.nativeElement.click(); return
      case 'patch-remove': return this.promptClearCustomPatch()
      case 'omatic': return this.showOmaticModal()
      case 'diagnostics': return this.showDiagnosticsModal()
      case 'disk-copy': return this.downloadFullDiskChanges()
      case 'live-keyboard': return this.toggleLiveKeyboard({ detail: { checked: !!event.value } })
      case 'idle-pause': return this.toggleIdlePause({ detail: { checked: !!event.value } })
      case 'camera': return this.toggleCamera({ detail: { checked: !!event.value } })
      case 'wipe': return this.confirmWipe()
    }
  }

  /**
   * A key from the control deck that could not be sent says so. Rate-limited because the usual
   * cause (no emulator, or one that has exited) is also what makes the next tap fail, and a dialog
   * per tap would bury the one that matters. The deck greys its keys for the same interval (the
   * key queue's fault cooldown), so a held arrow raises this once.
   */
  onKeyFailure(error: unknown) {
    const now = Date.now()
    if (now - this.lastKeyFailureAt < GamePage.KEY_FAILURE_REPORT_INTERVAL_MS) return
    this.lastKeyFailureAt = now
    void this.showErrorAlert(error instanceof Error ? error : new Error(String(error)))
  }

  async applyPatch(patch: JSZip) {
    this.autoSaverService.stop()
    this.autoSaverService.stopPeriodicSave()
    this.stopSafetyNets()

    const loading = await this.loadingController.create({
      message: 'Aplicando patch...',
      backdropDismiss: false
    });
    await loading.present();
    let written = false
    try {
      await this.saveGameService.saveGame()
      await this.patchService.applyPatch(this.dosCI, patch)
      written = true
      await loading.dismiss()
      const alert = await this.alertController.create({
        header: 'Patch aplicado',
        message: 'O patch foi aplicado com sucesso.\nO jogo será reiniciado.',
        cssClass: 'win9x-alert alert-whitespace',
        backdropDismiss: false,
        buttons: [{
          text: 'Recarregar',
          handler: async () => {
            this.reloadPage()
          }
        }]
      });
      await alert.present();
      await this.dosCI.exit()
    } catch (e: any) {
      console.error(e)
      await loading.dismiss()
      if (!written) {
        // Nothing was replaced, so the game goes on as it was, with its saving back on. Once the
        // layer is written the running VM must not be persisted over it, so then it stays off.
        await this.restoreSaving()
      }
      await this.showErrorAlert(e)
    }

  }

  async promptClearCustomPatch() {
    const alert = await this.alertController.create({
      header: 'Aviso',
      message: 'Tem certeza que deseja remover o patch customizado? \nOs times e bandeiras serão revertidos ao estado original',
      backdropDismiss: false,
      cssClass: 'win9x-alert alert-whitespace',
      buttons: [{
        text: 'Não',
        role: 'cancel'
      }, {
        text: 'Sim',
        handler: async () => {
          await this.clearCustomPatch()
        }
      }]
    })
    await alert.present()
  }

  /**
   * "Importar jogos salvos": any number of `.e98` files and `.zip` backups. The list of what is
   * about to happen, with the replacements flagged, comes before anything is touched.
   *
   * The input is emptied in `finally`, on every way out: a file input fires `change` only when
   * its value changes, so choosing the same file again (after answering "Cancelar" to the confirm,
   * say) would otherwise do nothing at all. The files are copied out of it first, because
   * emptying it empties `input.files`. A picker that was closed without choosing is not an
   * error, just nothing to do.
   */
  async onSaveFileSelected(e: Event) {
    const input = e.target as HTMLInputElement
    const files = Array.from(input.files ?? [])
    this.closeMenu()

    try {
      if (files.length === 0) return
      console.log("Save files selected", { files })

      const loading = await this.loadingController.create({
        message: 'Validando arquivos...',
        backdropDismiss: false
      });
      await loading.present();

      try {
        const plan = await this.patchService.prepareSaveFilesPatch(files)
        const overwrites = SaveBackupHelper.overwrites(plan.saves, await this.patchService.existingSaveNames(this.dosCI))
        await loading.dismiss()

        const skipped = SaveBackupHelper.skippedMessage(plan)
        const alert = await this.alertController.create({
          header: 'Importar jogos salvos',
          message: SaveBackupHelper.importMessage(plan.saves, overwrites) + (skipped ? `\n\n${skipped}` : ''),
          backdropDismiss: false,
          cssClass: 'win9x-alert alert-whitespace',
          buttons: [{
            text: 'Cancelar',
            role: 'cancel'
          }, {
            text: overwrites.length > 0 ? 'Substituir e importar' : 'Importar',
            cssClass: overwrites.length > 0 ? 'alert-danger' : undefined,
            handler: async () => {
              await this.applySaveGamePatch(plan)
            }
          }]
        });
        await alert.present();
      } catch (e: any) {
        console.error(e)
        await loading.dismiss()
        await this.showErrorAlert(e)
      }
    } finally {
      input.value = ''
    }
  }

  /** "Carregar Patch". Emptied and tolerant of an empty selection for the same reasons as above. */
  async onPatchFileSelected(e: Event) {
    const input = e.target as HTMLInputElement
    const file: File | undefined = input.files?.[0]
    this.closeMenu()

    try {
      if (!file) return
      console.log("Patch File selected", { file })
      const loading = await this.loadingController.create({
        message: 'Validando patch...',
        backdropDismiss: false
      });
      await loading.present();

      try {
        const patch = await this.patchService.processPatchFile(file)
        const numberOfFiles = Object.keys(patch.files).length
        await loading.dismiss()
        const alert = await this.alertController.create({
          header: 'Confirmação',
          message: `${numberOfFiles} arquivos do patch serão carregados, incluindo bandeiras, equipes e arquivos de configuração\n Continuar?`,
          backdropDismiss: false,
          cssClass: 'win9x-alert alert-whitespace',
          buttons: [{
            text: 'Não',
            role: 'cancel'
          }, {
            text: 'Sim',
            handler: async () => {
              await this.applyPatch(patch)
            }
          }]
        });
        await alert.present();
      } catch (e: any) {
        console.error(e)
        await loading.dismiss()
        await this.showErrorAlert(e)
      }
    } finally {
      input.value = ''
    }
  }

  /**
   * "Salvar e recarregar". The old entry reloaded without saving, directly above "Voltar ao menu",
   * which saves, so the two read as the same thing. This one saves first, and only on proof that
   * the game is not in the middle of writing its own save (SavePolicyHelper): a reading that
   * cannot be made does not become permission, it becomes a question.
   */
  async confirmRefresh() {
    this.closeMenu()
    const alert = await this.alertController.create({
      header: 'Salvar e recarregar?',
      message: 'O jogo será salvo no navegador e a página recarregada.\n\nO que você não gravou dentro do próprio jogo será perdido.'
        + (this.isStreaming ? '\n\nA sala será encerrada.' : ''),
      backdropDismiss: false,
      cssClass: 'win9x-alert alert-whitespace',
      buttons: [{
        text: 'Cancelar',
        role: 'cancel'
      }, {
        text: 'Salvar e recarregar',
        role: 'confirm'
      }]
    })
    await alert.present()
    const { role } = await alert.onDidDismiss()
    if (role !== 'confirm') return

    const loading = await this.loadingController.create({
      message: 'Salvando...',
      backdropDismiss: false
    })
    await loading.present()
    let result: SaveBeforeReloadResult
    try {
      result = await this.saveSafety.saveBeforeReload()
    } finally {
      await loading.dismiss()
    }

    if (result === 'saved') {
      this.reloadPage()
    } else if (result === 'busy') {
      const busy = await this.alertController.create({
        header: 'O jogo está gravando',
        message: 'O Elifoot está gravando o jogo neste instante. Espere alguns segundos e tente de novo.',
        backdropDismiss: false,
        cssClass: 'win9x-alert alert-whitespace',
        buttons: ['OK']
      })
      await busy.present()
    } else {
      await this.offerReloadWithoutSaving(result === 'failed')
    }
  }

  /**
   * The progress could not be saved, and reloading throws it away: say so, and let the player
   * decide (the chip, or "Salvar agora", can still be tried first).
   */
  private async offerReloadWithoutSaving(saveFailed: boolean) {
    const alert = await this.alertController.create({
      header: 'Não foi possível salvar',
      message: (saveFailed
        ? 'O jogo não pôde ser salvo agora.'
        : 'Não foi possível confirmar que o jogo terminou de gravar, então ele não foi salvo agora.')
        + '\n\nRecarregar agora perde o que não foi salvo.',
      backdropDismiss: false,
      cssClass: 'win9x-alert alert-whitespace',
      buttons: [{
        text: 'Cancelar',
        role: 'cancel'
      }, {
        text: 'Recarregar sem salvar',
        cssClass: 'alert-danger',
        handler: () => { this.reloadPage() }
      }]
    })
    await alert.present()
  }

  /**
   * Reload the page on purpose. The browser's "leave site?" prompt is for the closes nobody
   * chose (a tab, a swipe); every reload the app starts has already said what it costs, and
   * asking again would be a second confirm for the same decision.
   */
  private reloadPage() {
    this.leaving = true
    this.saveStatus.allowExit()
    window.location.reload()
  }

  /**
   * The route guard's question (see NavigationGuardHelper): Back, the Android Back button and an
   * iOS edge swipe leave the game without passing through "Voltar ao menu". A window that is open
   * (the options sheet, "Dados e avançado", the guide) is closed first and the page stays; after
   * that they get that menu's own dialog instead, once.
   */
  async canLeave(currentUrl: string, nextUrl: string): Promise<boolean> {
    const top = await this.topWindow()
    const verdict = NavigationGuardHelper.verdict({
      currentUrl,
      nextUrl,
      leaving: this.leaving || this.destroyed,
      hasEmulator: !!this.dosCI,
      promptOpen: this.leavePromptOpen,
      windowOpen: !!top,
    })
    this.diagnostics.log('page', 'leave guard', () => ({ verdict, to: NavigationGuardHelper.pathOf(nextUrl) }))
    if (verdict === 'close-window') void top?.dismiss(undefined, 'back')
    if (verdict === 'prompt') void this.confirmLeaveGame()
    return verdict === 'allow'
  }

  /**
   * The modal on top, when nothing is over it. An alert or a loader over a window is not the window's to close (the dialog is the
   * thing the person is looking at, and a loader cannot be dismissed at all), so then there is none and the guard answers as it did.
   */
  private async topWindow(): Promise<HTMLIonModalElement | null> {
    if (await this.alertController.getTop() || await this.loadingController.getTop()) return null
    return (await this.modalController.getTop()) ?? null
  }

  /** Everything that watches the running game for the length of this page. */
  private startSafetyNets() {
    if (this.destroyed || !this.dosCI) return
    this.saveSafety.attach(this.dosCI, { isHosting: () => this.multiplayerService.isHosting })

    // Armed only once the game's own screen has been seen: Windows draws the very desktop the
    // watcher looks for while the game loads. When the boot's window ran out before the game
    // showed (a slow phone), the watcher waits for the same green itself instead of staying off
    // for the whole session.
    this.exitSubscription?.unsubscribe()
    this.exitSubscription = this.exitWatcher.exited$.subscribe(() => void this.onGameExited())
    this.exitWatcher.start(this.dosCI, this.gameDetected ? {} : { armWhen: frame => BootStageHelper.isGameScreen(frame) })
    this.netsUp = true
    this.syncIdlePause()
  }

  /**
   * Detach everything `startSafetyNets` attached. Safe to call twice. The idle pause is one of
   * them, and goes first, so the guest is awake for whatever the caller does next.
   */
  private stopSafetyNets() {
    // First: every flow that stops the nets is about to rewrite the saved disk, exit the emulator or
    // leave, and none of them wants a guest that is asleep (or about to be put to sleep) under it.
    this.netsUp = false
    this.syncIdlePause()
    this.saveSafety.detach()
    this.exitWatcher.stop()
    this.exitSubscription?.unsubscribe()
    this.exitSubscription = undefined
  }

  /**
   * Elifoot quit to the Program Manager (GameExitWatcherService): its first dialog's Esc and
   * Cancelar do it, and so does a crash. The only way back is a reload, so the dialog offers it,
   * with the disk saved first. There is nothing to wait for before saving: the game is not
   * running, so it cannot be in the middle of writing a save.
   */
  private async onGameExited() {
    if (this.destroyed || this.leaving || this.exitBannerOpen) return
    this.exitBannerOpen = true
    this.diagnostics.log('frame', 'exit dialog shown')

    const alert = await this.alertController.create({
      header: 'O Elifoot foi fechado',
      message: 'O jogo saiu para o Gerenciador de Programas do Windows e não volta sozinho. O que já foi gravado dentro dele é mantido.\n\nReiniciar jogo?'
        + (this.isStreaming ? '\n\nA sala será encerrada.' : ''),
      backdropDismiss: false,
      cssClass: 'win9x-alert alert-whitespace',
      buttons: [{
        text: 'Agora não',
        role: 'cancel'
      }, {
        text: 'Reiniciar jogo',
        role: 'confirm'
      }]
    })
    await alert.present()
    const { role } = await alert.onDidDismiss()
    this.exitBannerOpen = false
    this.diagnostics.log('frame', 'exit dialog answered', () => ({ role }))
    if (role === 'confirm') await this.restartAfterExit()
  }

  private async restartAfterExit() {
    this.autoSaverService.stop()
    this.autoSaverService.stopPeriodicSave()
    this.stopSafetyNets()
    // The dialog said the room ends; leaving it properly tells the spectators, who would
    // otherwise wait out the grace period on a host that simply vanished.
    this.multiplayerService.leaveRoom()

    const loading = await this.loadingController.create({
      message: 'Reiniciando o jogo...',
      backdropDismiss: false
    })
    await loading.present()
    try {
      // Bounded: the loader cannot be dismissed, and a flush that never answers (IndexedDB stalls
      // after a mobile browser has been in the background) must not pin it over the screen.
      await TimeoutHelper.withTimeout(() => this.saveGameService.saveGame(), AUTO_SAVER.PERSIST_TIMEOUT_MS)
    } catch (e) {
      // Whatever the game had written is in the last snapshot; restarting is still the way out.
      console.error('Could not save before restarting the game', e)
    }
    try {
      await TimeoutHelper.withTimeout(() => this.dosCI.exit(), GAME_EXIT_WATCH.EXIT_TIMEOUT_MS)
    } catch (e) {
      console.warn('The emulator did not exit cleanly before the reload', e)
    }
    this.reloadPage()
  }

  /**
   * Leave the game and go back to the landing page.
   *
   * `/game` had no exit at all, which is why the installed PWA could never reach spectator
   * mode: it opened straight into the emulator and stayed there.
   */
  async confirmLeaveGame() {
    this.closeMenu()
    if (this.leavePromptOpen) return
    this.leavePromptOpen = true
    const alert = await this.alertController.create({
      header: 'Voltar ao menu?',
      message: this.isStreaming
        ? 'O jogo será salvo e a sala será encerrada. Os espectadores serão desconectados.'
        : 'O jogo será salvo antes de sair.',
      cssClass: 'win9x-alert alert-whitespace',
      buttons: [{
        text: 'Cancelar',
        role: 'cancel'
      }, {
        text: 'Sair',
        handler: async () => {
          await this.leaveGameToMenu()
        }
      }]
    })
    void alert.onDidDismiss().then(() => { this.leavePromptOpen = false })
    await alert.present()
  }

  /**
   * Full teardown, in an order that matters.
   *
   * The room is left explicitly so spectators get a clean departure instead of waiting out a
   * grace period on a host that simply vanished. Then the disk is flushed, and only after that are
   * the tickers stopped and the emulator told to exit.
   *
   * **The auto-saver must still be running when the flush is asked for.** The flush first asks the
   * game whether its own save dialog is up and waits for it to close (SaveSafetyService), and that
   * look needs the auto-saver's OCR worker: stopped first, the look is skipped and the disk is
   * copied under a half-written `.e98`, which is the truncation the wait exists to prevent. A
   * persist the auto-saver starts meanwhile queues behind ours (`SaveGameService.saveGame` runs one
   * at a time), so the two cannot overlap, and nothing runs between the flush and the stop.
   *
   * `leaving` is what tells the route guard that the navigation it is about to see is this one,
   * and the exit watcher goes first so a game on its way out cannot raise "O Elifoot foi fechado".
   */
  private async leaveGameToMenu() {
    this.leaving = true
    const loading = await this.loadingController.create({
      message: 'Salvando e saindo...',
      backdropDismiss: false
    })
    await loading.present()

    try {
      this.touchInputService.detach('leaving the game')
      this.exitWatcher.stop()
      this.stopObservingOverlay?.()
      this.multiplayerService.leaveRoom()
      const saved = await this.saveSafety.saveNow('leave')
      if (saved.outcome === 'no-emulator') {
        // The nets were never attached or were taken down (a patch that failed, a settings step
        // that threw): the old path saved anyway, and leaving without a save would be a regression.
        await this.saveGameService.saveGame()
      }
      this.autoSaverService.stop()
      this.autoSaverService.stopPeriodicSave()
      this.stopSafetyNets()
      // After the save, not before: the screen stays on for as long as the flush takes.
      this.wakeLock.stop()
      await this.dosCI?.exit()
    } catch (e: any) {
      // Never strand the user in the emulator over a failed save: report and leave anyway.
      console.error('Failed to tear the game down cleanly', e)
    } finally {
      await loading.dismiss()
    }

    // A hard document load, NOT a routerLink. Angular would tear the page down while js-dos
    // keeps its DOSBox instance and wasm module alive, so re-entering /game would create a
    // second one on top of the first. Changing only the hash does not reload, hence both
    // statements.
    this.saveStatus.allowExit()
    window.location.hash = '#/main'
    window.location.reload()
  }

  /**
   * The room dialog for an arrival that asked to host (the landing page's "Jogar e transmitir para amigos" and the PWA's "Hospedar"
   * shortcut both arrive as `?host=1`), asked for while the emulator boots. The dialog needs no emulator, and the 4 to 20 seconds
   * the game takes to come up are the best time there is to fill in a form; hosting itself needs the canvas, so it waits for the game
   * (`startRoomAskedForWhileBooting`) and the page is never reloaded for it, which would end the room.
   *
   * Stripping `?host=1` is load-bearing, not tidiness: PatchService applies a patch by rewriting the IndexedDB disk image and forcing
   * `window.location.reload()`. With the flag still on the URL, every patch reload, and every failure retry, which also reloads, would
   * open this dialog again, forever. `replaceUrl` keeps it out of the history too, so Back does not resurrect it either.
   *
   * Resolves with the answer, or null for a cancelled dialog. It never rejects: a failure here must not stop the game from starting.
   */
  private async askForRoomWhileBooting(): Promise<RoomSetupResult | null> {
    try {
      await this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {},
        replaceUrl: true
      })
      const setup = await this.multiplayerUiService.promptRoomSetup('host', this.hostRoomId, {
        help: () => { void this.openGuide('multiplayer') },
      })
      this.diagnostics.log('page', 'host intent answered', () => ({ confirmed: !!setup, gameUp: !this.booting }))
      // The game is still starting: the boot screen says the room is waiting for it (and a room that is not wanted says nothing).
      this.hostWaitingForBoot = !!setup && this.booting
      return setup
    } catch (e) {
      console.error('Could not ask for the room while the game starts', e)
      return null
    }
  }

  /**
   * Once the game is up: put on the air the room the person asked for while it started. Waits for the dialog if it is still open, so the
   * first-run coach never lands on top of it. Returns whether a room is now live, which tells the caller that this visit has done what it was for.
   */
  private async startRoomAskedForWhileBooting(): Promise<boolean> {
    const dialog = this.hostDialog
    if (!dialog) return false
    this.hostDialog = undefined
    const setup = await dialog
    this.hostWaitingForBoot = false
    if (!setup || this.destroyed) return false
    this.applyHostSetup(setup)
    await this.startHosting()
    return this.isStreaming
  }

  private applyHostSetup(setup: RoomSetupResult) {
    this.hostName = setup.playerName;
    this.hostRoomId = setup.roomCode;
    this.hostPassword = setup.password;
    this.hostColor = setup.playerColor;
    this.hostMaxSpectators = setup.maxSpectators ?? MULTIPLAYER.DEFAULT_MAX_SPECTATORS;
  }

  /**
   * Compose a text and type it into whatever the game has focused. Accents work (they are
   * sent as Alt codes, see EmulatorKeyCodeHelper), a line break is an Enter, which is how
   * several fields of a form are filled in one go, and anything the game cannot show is typed
   * as "?".
   */
  async promptInputText() {
    // Two keyboards at once help nobody: the bar's text is mirrored first, then it gives way.
    this.typeBar?.close()
    // Every one carries an accent, so the first thing the dialog says about accents is that
    // they are fine. Keep it that way when adding names: an unaccented pick says nothing.
    const placeholders = [
      'Tite\nFelipão\nParreira',
      'Zé Roberto',
      'Romário',
      'Júnior',
      'João André',
      'Sócrates',
      'Lúcio',
      'Kaká',
      'Ronaldinho Gaúcho',
      'Zinédine Zidane',
      'Mário Jardel',
      'Fábio Júnior',
      'Émerson',
    ]

    const randomIndex = Math.floor(Math.random() * placeholders.length);
    const randomPlaceholder = placeholders[randomIndex]

    const alert = await this.alertController.create({
      header: 'Input',
      message: 'Digite o texto que deseja enviar para o jogo.\nAcentos são enviados normalmente, e cada quebra de linha equivale a apertar Enter.',
      backdropDismiss: false,
      cssClass: 'win9x-alert alert-whitespace wide-alert',
      inputs: [{
        name: 'text',
        type: 'textarea',
        placeholder: randomPlaceholder
      }],
      buttons: [{
        text: 'Cancelar',
        role: 'cancel'
      }, {
        text: 'Enviar',
        role: 'send'
      }]
    })
    this.turnOffTextAssists(alert)
    await alert.present()

    const { role, data } = await alert.onDidDismiss()
    const text: string = data?.values?.text ?? ''
    if (role === 'send' && text) {
      await this.sendTextToGame(text)
    }
  }

  /**
   * Stop the phone's keyboard from rewriting a name on its way to the game: autocorrect
   * turns "Felipão" into "Felipe", and sentence capitalisation, suggestions and a trailing
   * auto-space all change what arrives. `enterkeyhint` is "enter", not "send", on purpose:
   * the field is a textarea, where that key inserts a line break (and a line break is how
   * several form fields get filled in one go), so a "send" label would sit on a key that does
   * not send.
   *
   * Set on the DOM and not through the input's `attributes` option. Ionic hands those to
   * Stencil, which assigns an element *property* wherever one exists, and `autocorrect` is a
   * boolean property in WebKit and Chromium: 'off' is a truthy string, so the assignment
   * writes autocorrect="on".
   *
   * The alert has rendered by the time `create()` resolves, so this runs before the field can
   * be focused.
   */
  private turnOffTextAssists(alert: HTMLElement) {
    const field = alert.querySelector('textarea, input')
    if (!field) return
    field.setAttribute('autocapitalize', 'off')
    field.setAttribute('autocorrect', 'off')
    field.setAttribute('autocomplete', 'off')
    field.setAttribute('spellcheck', 'false')
    field.setAttribute('enterkeyhint', 'enter')
  }

  /**
   * Type `text` into the game and, once it is long enough to take a while, say how far along
   * it is. Progress is a toast and not a second dialog: the dialog the text was composed in
   * hid the very field it was typing into, which is the problem with this whole flow, so what
   * is left on screen has to be something that leaves the game visible.
   */
  private async sendTextToGame(text: string) {
    const total = EmulatorKeyCodeHelper.planText(text).tasks.length
    let finished = false
    let cancelled = false
    let progress: Awaited<ReturnType<ToastController['create']>> | null = null

    if (total >= EMULATOR_CONTROL_CONFIG.PROGRESS_MIN_CHARACTERS) {
      progress = await this.toastController.create({
        message: `Enviando 0/${total}`,
        position: 'bottom',
        buttons: [{ text: 'Cancelar', role: 'cancel' }]
      })
      // Any way of closing it before the send ends (the button, or the swipe-away on iOS)
      // is a request to stop.
      void progress.onDidDismiss().then(() => {
        if (finished) return
        cancelled = true
        this.emulatorControlService.cancelKeys()
      })
      await progress.present()
      // Cancelar can land while the toast is still sliding in, before there is anything queued.
      if (cancelled) return
    }

    try {
      const result = await this.emulatorControlService.sendString(this.dosCI, text, (done, count) => {
        if (progress) progress.message = `Enviando ${done}/${count}`
      })
      finished = true
      await progress?.dismiss()

      if (result.cancelled) {
        await this.multiplayerUiService.showToast(
          `Envio cancelado: ${result.completed} de ${result.total} caracteres enviados.`, 'warning', 4000)
      } else if (result.substituted > 0) {
        await this.multiplayerUiService.showToast(
          result.substituted === 1
            ? '1 caractere sem equivalente no jogo foi enviado como "?".'
            : `${result.substituted} caracteres sem equivalente no jogo foram enviados como "?".`,
          'warning', 4000)
      }
    } catch (error) {
      finished = true
      await progress?.dismiss()
      await this.showErrorAlert(error instanceof Error ? error : new Error(String(error)))
    }
  }

  async promptHostRoom() {
    this.closeMenu();
    const setup = await this.multiplayerUiService.promptRoomSetup('host', this.hostRoomId, {
      help: () => { void this.openGuide('multiplayer') },
    });
    if (!setup) return;

    this.applyHostSetup(setup);
    await this.startHosting();
  }

  async startHosting() {
    this.isHosting = true;
    const loading = await this.loadingController.create({ message: 'Criando sala e iniciando streaming...' });
    await loading.present();

    let hostingError: Error | undefined;
    try {
      const stream = await this.captureGameCanvasStream();
      // Added before the first publish and never again: a track added to a live room would
      // need a renegotiation trystero does not perform. Null when the game has no audio,
      // which leaves the picture going out on its own.
      const audioTrack = this.multiplayerAudioService.capture(!this.spectatorAudioDisabled);
      if (audioTrack) stream.addTrack(audioTrack);
      await this.multiplayerService.hostGameRoom(
        this.hostName,
        this.hostRoomId,
        this.hostPassword,
        stream,
        this.hostColor,
        this.hostMaxSpectators
      );

      this.isStreaming = true;

      // Subscribe to cursor updates
      this.prepareRemoteCursorContainer();
      this.multiplayerSubscriptions.add(
        this.multiplayerCursorService.getCursorsObservable().subscribe(cursors => {
          this.renderCursors(cursors);
        })
      );

      this.multiplayerSubscriptions.add(
        this.multiplayerCursorService.getClickObservable().subscribe(click => {
          if (click) this.renderClick(click);
        })
      );

      this.observeCanvasForOverlay();

      // A collision is now detected whenever it becomes observable, which can be after
      // hosting has already started — so it arrives here rather than as a throw.
      this.multiplayerSubscriptions.add(
        this.multiplayerService.hostCollision$.subscribe(code => this.onRoomCodeTaken(code))
      );
      this.multiplayerSubscriptions.add(
        this.multiplayerService.codeContested$.subscribe(() => this.onCodeContested())
      );
      this.multiplayerSubscriptions.add(
        this.multiplayerService.intrusion$.subscribe(kind => this.onIntrusion(kind))
      );
      // Once per hosting session, whenever it becomes known — immediately if an earlier room in
      // this page already found the relay down. `take(1)` so a flapping relay is one toast.
      this.multiplayerSubscriptions.add(
        this.relayHealthService.health$
          .pipe(filter(health => health === 'unavailable'), take(1))
          .subscribe(() => this.onRelayUnavailable())
      );
      // Host-only on purpose: a spectator can do nothing about another spectator's link,
      // and the roster already tells anyone who opens it. Edge-triggered and rate-limited
      // upstream, so this cannot become a toast storm.
      this.multiplayerSubscriptions.add(
        this.playerInfoService.connectionWarning$.subscribe(player => this.onConnectionWarning(player))
      );
    } catch (err: any) {
      // A failed host claim already left the room, but a capture failure did not.
      this.multiplayerService.leaveRoom();
      this.isStreaming = false;
      hostingError = new Error(err.message || 'Erro ao criar sala.');
    } finally {
      this.isHosting = false;
      await loading.dismiss();
    }

    // Both of these present overlays, so they wait until the loader is gone.
    if (hostingError) {
      await this.showErrorAlert(hostingError);
    } else if (this.isStreaming) {
      // A toast, not the old blocking "Sala criada!" alert: the status pill carries the
      // code for as long as the room is up, so nothing has to be memorised before
      // dismissing anything. Skipped when the room is already gone — a collision can be
      // resolved before we get here, and announcing a dead room reads as a bug.
      await this.multiplayerUiService.showRoomCreated(this.hostRoomId);
    }
  }

  async promptStopHosting() {
    this.closeMenu();
    const confirmed = await this.multiplayerUiService.confirmLeave(
      'Os espectadores serão desconectados e a transmissão será encerrada.'
    );
    if (confirmed) this.stopHosting();
  }

  /**
   * Another host was already on this code and we are the one that yielded. The service
   * has already torn the room down; the game itself is untouched.
   */
  private async onRoomCodeTaken(code: string) {
    this.resetHostingUi();
    // The room was on air long enough to be announced, so take that announcement down
    // before saying the code is taken. `startHosting` covers the opposite order.
    await this.multiplayerUiService.dismissRoomCreated();

    const alert = await this.alertController.create({
      header: 'Código de sala já em uso',
      cssClass: 'win9x-alert alert-whitespace',
      message: `Já existe uma sala em andamento com o código ${code}. Sua transmissão foi ` +
        'encerrada e quem estava assistindo foi desconectado, mas seu jogo continua aqui.',
      backdropDismiss: false,
      buttons: [
        { text: 'Fechar', role: 'cancel' },
        {
          text: 'Gerar novo código',
          handler: () => {
            this.hostRoomId = '';
            // Deferred so the modal opens after this alert has finished dismissing.
            setTimeout(() => this.promptHostRoom());
          }
        },
      ]
    });
    await alert.present();
  }

  /** Someone else tried our code and lost the tie-break. Our broadcast is untouched. */
  private async onCodeContested() {
    await this.multiplayerUiService.showToast(
      'Alguém tentou abrir outra sala com o seu código. Sua transmissão continua no ar.',
      'warning'
    );
  }

  private async onIntrusion(kind: MultiplayerJoinErrorKind) {
    // Informational only: a stranger failing to get in must never disturb a live
    // broadcast, so this is a toast and never touches the room.
    const message = kind === 'wrong-password'
      ? 'Alguém tentou entrar com a senha errada.'
      : kind === 'room-full'
        ? `Alguém tentou entrar, mas a sala está cheia (limite de ${this.hostMaxSpectators} ${this.hostMaxSpectators === 1 ? 'espectador' : 'espectadores'}).`
        : 'Alguém tentou entrar, mas a conexão não foi estabelecida.';
    // 'warning', not the default green: a failed entry attempt is not good news.
    await this.multiplayerUiService.showToast(message, 'warning');
  }

  /**
   * The relay (TURN) is not answering. Spectators on ordinary networks are unaffected — most
   * connect directly — but those on mobile data, a VPN or a corporate network may fail to join,
   * and they would otherwise look exactly like a wrong code. Worded as "from here" because it is
   * equally true when this host's own network is what blocks the relay, and a long duration
   * because there is something to read and nothing to dismiss.
   */
  private async onRelayUnavailable() {
    await this.multiplayerUiService.showToast(
      'Conexão por relay indisponível. Espectadores em redes restritivas ' +
      '(dados móveis, VPN, redes corporativas) podem não conseguir entrar.',
      'warning',
      8000
    );
  }

  /**
   * A spectator's link went bad. Named rather than counted: the host's only real recourse
   * is to tell that person, so the name is the whole point of the notice.
   */
  private async onConnectionWarning(player: PlayerInfo) {
    const name = player.playerName?.trim() || player.peerId.slice(0, 6);
    await this.multiplayerUiService.showToast(`Conexão instável com ${name}.`, 'warning');
  }

  stopHosting() {
    this.multiplayerService.leaveRoom();
    this.resetHostingUi();
  }

  /**
   * Tear down the host-side UI. Deliberately does not touch the room: on a code
   * collision the service has already left before telling us.
   */
  private resetHostingUi() {
    this.stopObservingOverlay?.();
    this.stopObservingOverlay = undefined;

    // A fresh Subscription: the old one is closed and would reject later additions.
    this.multiplayerSubscriptions.unsubscribe();
    this.multiplayerSubscriptions = new Subscription();

    this.isStreaming = false;
    this.setChatOpen(false);
    this.hostPassword = '';

    // The panel unmounts with the room. Without this, focus is orphaned on <body> and the
    // host's physical keyboard stops reaching the game. No-op if the emulator is gone.
    ChatPanelHelper.focusEmulator();

    this.getOverlayElement()?.remove();
  }

  /**
   * The room's own window. Replaces the Compartilhar/Participantes/Chat/Encerrar quartet
   * that used to sit in the menu; the panel reports back what the user picked.
   */
  async openMultiplayerPanel() {
    this.closeMenu();
    const action = await this.multiplayerUiService.showMultiplayerPanel(
      'host', this.hostRoomId, !!this.hostPassword, this.hostMaxSpectators
    );

    switch (action) {
      case 'copy':
        await this.multiplayerUiService.copyRoomLink(this.hostRoomId);
        break;
      case 'share':
        await this.multiplayerUiService.shareRoom(this.hostRoomId);
        break;
      case 'leave':
        await this.promptStopHosting();
        break;
      case 'close':
        break;
    }
  }

  /**
   * The one place `isChatOpen` changes, because the stage has to hear of it: in landscape the chat is docked beside the
   * picture, and the picture's size is the plan's answer to whether it is.
   */
  private setChatOpen(open: boolean) {
    this.isChatOpen = open;
    this.stageLayout.setChat(open);
  }

  /**
   * The panel is always mounted while streaming, so opening it is a state flip plus a focus
   * move. Called by the chat's toggle and, on a touch device, by the control deck's Chat button.
   */
  toggleChat(force?: boolean) {
    const shouldOpen = typeof force === 'boolean' ? force : !this.isChatOpen;
    if (shouldOpen === this.isChatOpen) return;

    this.setChatOpen(shouldOpen);

    if (shouldOpen) {
      // The chat has a field of its own, and the type bar mirrors into the game: not both.
      this.typeBar?.close();
      ChatPanelHelper.focusPanel();
    } else {
      // Back to the game, not to the toggle: js-dos reads keys from .emulator-root.
      ChatPanelHelper.focusEmulator();
    }
  }

  /**
   * Escape closes the drawer, but only from inside it: on this page ESC is a game key, so a
   * document-level listener would steal it. stopPropagation also keeps it away from Ionic's
   * overlay handling.
   */
  onChatEscape(event: Event) {
    event.stopPropagation();
    this.toggleChat(false);
  }

  /** Redundant entry point: the drawer must not be reachable only from the handle. */
  openChatFromMenu() {
    this.closeMenu();
    this.toggleChat(true);
  }

  /** Accessible name for the handle, including the unread count. */
  chatToggleLabel(unread: number | null): string {
    return ChatPanelHelper.toggleAriaLabel(this.isChatOpen, unread);
  }

  async captureGameCanvasStream(): Promise<MediaStream> {
    // Wait for the canvas to be present in the DOM
    let canvas: HTMLCanvasElement | null = null;
    for (let i = 0; i < 20; i++) {
      canvas = document.getElementsByClassName('emulator-canvas')[0] as HTMLCanvasElement
      if (canvas) break;
      await new Promise(res => setTimeout(res, 250));
    }
    if (!canvas) throw new Error('Canvas do jogo não encontrada!');

    const canvasStream = (canvas as HTMLCanvasElement).captureStream(30)
    // Prefer 30fps, fallback to default
    return canvasStream
  }

  /** Close the menu, in whichever form it is open. */
  private closeMenu() {
    this.isPopoverOpen = false;
    this.isSheetOpen = false;
  }

  /** The shared funnel for generic errors — keep `win9x-alert` here so every caller inherits it. */
  private async showErrorAlert(errorMsg: Error) {
    const alert = await this.alertController.create({
      header: 'Erro',
      message: errorMsg.message,
      backdropDismiss: false,
      cssClass: 'win9x-alert',
      buttons: ['OK']
    });
    await alert.present();
  }

  private async clearCustomPatch() {
    this.closeMenu()
    this.stopSafetyNets()
    const loading = await this.loadingController.create({
      message: 'Limpando patch...',
      backdropDismiss: false
    })
    await loading.present()
    try {
      await this.patchService.clearPatch(this.dosCI)
      await loading.dismiss()
      const alert = await this.alertController.create({
        header: 'Patch Removido',
        message: 'O patch foi removido com sucesso. O jogo será reiniciado.',
        backdropDismiss: false,
        cssClass: 'win9x-alert',
        buttons: [{
          text: 'Recarregar',
          handler: async () => {
            this.reloadPage()
          }
        }]
      })
      await alert.present()

      await this.dosCI.exit()
    } catch (e: any) {
      console.error(e)
      await loading.dismiss()
      // Nothing was replaced, so the game goes on as it was.
      this.startSafetyNets()
      await this.showErrorAlert(e)
    }
  }

  private async applySaveGamePatch(plan: SaveImportPlan) {
    // Like a patch, this replaces what `layers.save()` persists with the edited layer: the
    // auto-saver, or the page going hidden, persisting the running VM now would write the saves
    // that were just imported out of the disk again.
    this.autoSaverService.stop()
    this.autoSaverService.stopPeriodicSave()
    this.stopSafetyNets()

    const loading = await this.loadingController.create({
      message: 'Importando jogos salvos...',
      backdropDismiss: false
    });
    await loading.present();

    let written = false
    try {
      await this.patchService.applySaveFilePatch(this.dosCI, plan.patch)
      written = true
      await loading.dismiss()
      const count = plan.saves.length
      const alert = await this.alertController.create({
        header: count === 1 ? 'Jogo salvo importado' : 'Jogos salvos importados',
        message: `${count === 1 ? '1 jogo salvo foi importado' : `${count} jogos salvos foram importados`} com sucesso.\nO jogo será reiniciado.`,
        cssClass: 'win9x-alert alert-whitespace',
        backdropDismiss: false,
        buttons: [{
          text: 'Recarregar',
          handler: async () => {
            this.reloadPage()
          }
        }]
      });
      await alert.present();
      await this.dosCI.exit()
    } catch (e: any) {
      console.error(e)
      await loading.dismiss()
      if (!written) {
        // Nothing was replaced, so the game goes on as it was, with its saving back on. Once the
        // layer is written the running VM must not be persisted over the imported saves.
        await this.restoreSaving()
      }
      await this.showErrorAlert(e)
    }
  }

  /**
   * Put back what a flow that was about to rewrite the layer took down (the auto-saver, the
   * periodic save, the safety nets) when it failed before writing anything.
   */
  private async restoreSaving() {
    await this.setupAutoSave()
    await this.setupPeriodicSave()
    this.startSafetyNets()
  }

  private prepareRemoteCursorContainer() {
    const gameContainer = document.querySelector('#game-container') as HTMLElement;
    if (!gameContainer) {
      console.warn('Game container not found for cursor overlay');
      return;
    }

    // Create the cursor overlay if it doesn't exist
    let cursorOverlay = this.getOverlayElement();
    if (!cursorOverlay) {
      cursorOverlay = document.createElement('div');
      cursorOverlay.id = 'cursors-overlay';
      cursorOverlay.className = 'pointer-overlay';
      gameContainer.appendChild(cursorOverlay);
    }
  }

  /**
   * js-dos re-lays-out its canvas whenever `#game-container` changes size: its resize
   * detector listens to that element (also `.emulator-root`) and re-runs the letterbox
   * closure from the container's offsetWidth/offsetHeight.
   *
   * The portrait chat and the control deck's band never cause that — the picture's box is
   * pinned to its 4:3 height there and they only share what is left — but these do: a window
   * resize, a rotation (which also drops the header in landscape-compact, changing ion-content's
   * height), the mobile URL bar collapsing, a fullscreen change, a landscape chat docking beside
   * the picture (the stage plan, StageLayoutService, gives the container its new size), the
   * player's view mode, and `isHidden` flipping `.full` on at boot. The deck's launcher sheet and
   * the rails' keys do NOT: the sheet is `position:absolute` over the page, and a rail is a
   * sibling whose width the plan already subtracted.
   *
   * Both the canvas and the container are observed. The container fires first, before
   * js-dos has rewritten the canvas geometry, so that pass aligns against the old canvas;
   * the canvas's own entry, one tick later, is what makes the result correct.
   */
  private observeCanvasForOverlay() {
    const canvas = this.getGameCanvas();
    const container = document.querySelector('#game-container') as HTMLElement | null;
    if (!canvas) return;

    this.stopObservingOverlay = OverlaySyncHelper.observe(
      [canvas, container],
      () => this.syncOverlayWithGameCanvas()
    );
    this.syncOverlayWithGameCanvas();
  }

  private renderCursors(cursors: { [peerId: string]: CursorPositionMessage }) {
    // Held so the toggle can restore the overlay without waiting for the next message. A
    // parked cursor sends nothing, so re-rendering from the live feed alone would leave
    // exactly the cursors someone hid the overlay to get rid of missing until they moved.
    this.latestCursors = cursors;
    const overlay = this.getOverlayElement();
    if (!overlay) return;
    // An empty map is how the helper is told to remove what it has already drawn, so
    // hiding needs no separate teardown path.
    CursorRendererHelper.renderCursors(overlay, this.spectatorCursorsHidden ? {} : cursors);
  }

  private renderClick(click: CursorClickMessage) {
    if (this.spectatorCursorsHidden) return;
    const overlay = this.getOverlayElement();
    if (!overlay) return;
    CursorRendererHelper.renderClick(overlay, click);
  }

  private getOverlayElement(): HTMLElement | null {
    return document.querySelector('#cursors-overlay');
  }

  private getGameCanvas(): HTMLElement | null {
    return document.querySelector('.emulator-canvas');
  }

  private syncOverlayWithGameCanvas() {
    const gameCanvas = this.getGameCanvas();
    const overlay = this.getOverlayElement();
    if (gameCanvas && overlay) {
      OverlaySyncHelper.align(overlay, gameCanvas);
      // Must run AFTER align: repositionAll reads the overlay's fresh offsetWidth/Height.
      // Cursors already on screen keep the pixels renderCursors gave them until their peer
      // moves, so nothing else re-derives them.
      CursorRendererHelper.repositionAll(overlay);
    }
  }
}
