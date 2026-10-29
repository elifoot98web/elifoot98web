import { Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertController, LoadingController, ModalController, ToastController } from '@ionic/angular/lazy';
import { AlertButton } from '@ionic/core';
import JSZip from 'jszip';
import { environment } from 'src/environments/environment';
import { AUTO_SAVER, DISPLAY_MODE, EMULATOR_CONTROL_CONFIG, GAME_BOOT, GAME_EXIT_WATCH, GAME_INPUT_FN_BTNS, GAME_INPUT_FN_BTNS_REVERSED, MULTIPLAYER, SAVE_SAFETY, STORAGE_KEY } from '../../core/models/constants';
import { UserGuideComponent } from './components/user-guide/user-guide.component';
import { AboutComponent } from './components/about/about.component';
import { OmaticModalComponent } from './components/omatic-modal/omatic-modal.component';
import { DiagnosticsModalComponent } from './components/diagnostics-modal/diagnostics-modal.component';
import { DiagnosticsReportHelper } from 'src/app/core/helpers/diagnostics-report.helper';
import { filter, map, Observable, Subscription, take } from 'rxjs';
import { EmulatorKeyCode, EmulatorKeyCodeHelper } from '../../core/models/game';
import { CursorClickMessage, CursorPositionMessage, MultiplayerJoinErrorKind, PlayerInfo } from '../../core/models/multiplayer';
import { AutoSaverService, EmulatorControlService, GameExitWatcherService, PatchService, SaveBeforeReloadResult, SaveGameService, SaveImportPlan, SaveSafetyService, SavesBackup, TouchInputService } from '../../core/services/game';
import { DiagnosticsService, LayoutHelperService, LocalStorageService, SaveStatusService } from '../../core/services/shared';
import { MultiplayerAudioService, MultiplayerChatService, MultiplayerCursorService, MultiplayerPlayerInfoService, MultiplayerRelayHealthService, MultiplayerService, MultiplayerUiService } from '../../core/services/multiplayer';
import { CursorRendererHelper } from 'src/app/core/helpers/cursor-renderer.helper';
import { OverlaySyncHelper } from 'src/app/core/helpers/overlay-sync.helper';
import { ChatPanelHelper } from 'src/app/core/helpers/chat-panel.helper';
import { BootFailureHelper, BootFailureKind } from 'src/app/core/helpers/boot-failure.helper';
import { BootProgressHelper } from 'src/app/core/helpers/boot-progress.helper';
import { BootStage, BootStageHelper } from 'src/app/core/helpers/boot-stage.helper';
import { TimeoutHelper } from 'src/app/core/helpers/timeout.helper';
import { DisplayMode, DisplayModeHelper } from 'src/app/core/helpers/display-mode.helper';
import { TouchMode, TouchModeHelper } from 'src/app/core/helpers/touch-mode.helper';
import { SaveBackupHelper } from 'src/app/core/helpers/save-backup.helper';
import { SaveStatusHelper } from 'src/app/core/helpers/save-status.helper';
import { NavigationGuardHelper } from 'src/app/core/helpers/navigation-guard.helper';


@Component({
    selector: 'app-game',
    templateUrl: './game.page.html',
    styleUrls: ['./game.page.scss'],
    standalone: false
})
export class GamePage implements OnInit, OnDestroy {
  EmulatorKeyCode = EmulatorKeyCode
  @ViewChild('popover') popover: any;
  // UI state properties
  smoothFilterDisabled = false;
  spectatorCursorsHidden = false;
  spectatorAudioDisabled = false;
  private latestCursors: { [peerId: string]: CursorPositionMessage } = {};
  autoSaveDisabled = false;
  periodicSave = false;
  isPopoverOpen = false;
  isVirtualKeyboardShowing = false;
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
   * Reactive breakpoints for the floating status pill. The synchronous getters below are
   * fine for markup that is re-evaluated anyway, but the pill has to appear and disappear on
   * rotation, which needs an emission.
   */
  isMobile$: Observable<boolean>;
  isLandscape$: Observable<boolean>;

  /**
   * Whether the options menu offers "Modo de toque": a finger is the primary pointer AND the
   * classic touchpad would work on this device (see TouchModeHelper). Reactive, because a
   * convertible changes its primary pointer when the keyboard is detached.
   */
  touchModeChoice$: Observable<boolean>;
  /** The person's choice. What is actually in force is {@link TouchModeHelper.effective}. */
  touchMode: TouchMode = 'direct';

  private static readonly KEY_FAILURE_REPORT_INTERVAL_MS = 5000;
  private lastKeyFailureAt = 0;

  private multiplayerSubscriptions = new Subscription();
  private stopObservingOverlay?: () => void;

  /** The boot overlay while it is up, so leaving the page mid-boot does not strand it. */
  private bootLoading?: Awaited<ReturnType<LoadingController['create']>>;
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
    chatService: MultiplayerChatService
  ) {
    this.unreadCount$ = chatService.unreadCount$;
    this.participantCount$ = this.playerInfoService.playerList$.pipe(map(players => players.length));
    this.isMobile$ = this.layoutHelperService.isMobile$;
    this.isLandscape$ = this.layoutHelperService.isLandscape$;
    this.touchModeChoice$ = this.layoutHelperService.matches$('(pointer: coarse)').pipe(
      map(coarse => TouchModeHelper.offersChoice(coarse, navigator.userAgent))
    );
  }

  /**
   * The one "debug" switch: the diagnostics log. This used to be a field that was always
   * `false` and that nothing could set; it gates the menu's "Baixar Disco Virtual" item, which
   * is a developer's tool, and turning the diagnostics on is the same kind of decision.
   */
  get debugMode(): boolean {
    return this.diagnostics.enabled
  }

  /** The subtitle of the "Salvar agora" menu entry: what the toolbar chip says, for the layouts that have no toolbar. */
  get saveSummary(): string {
    return SaveStatusHelper.describe(this.saveStatus.snapshot, Date.now()).text
  }

  /** The subtitle of the "Diagnóstico" menu entry. */
  get diagnosticsSummary(): string {
    if (!this.diagnostics.enabled) return 'Desligado'
    const events = DiagnosticsReportHelper.events(this.diagnostics.entryCount)
    return this.diagnostics.sessionOnly ? `Ligado nesta visita · ${events}` : `Ligado · ${events}`
  }

  async ngOnInit() {
    console.time("carregando game...")
    // Not awaited: the chip shows "Ainda não salvo" for the few milliseconds it takes, and the
    // boot has nothing to wait for.
    void this.saveStatus.load()
    await this.bootGame()
  }

  /**
   * Start the emulator and, once it is up, make the page usable. Can run more than once per page
   * load: "Continuar esperando" after a timeout comes back here, and `elifootMain` re-attaches to
   * the boot that is still running.
   *
   * Only a failure to START the emulator is a boot failure. What follows (settings, the welcome
   * dialog, the host intent) runs with a working game behind it, so an exception there is
   * logged and reported but never reloads the page, which is what the old catch-all did to a
   * game that was running fine.
   */
  private async bootGame() {
    const loading = await this.loadingController.create({
      message: 'Carregando o jogo…',
      backdropDismiss: false
    });
    this.bootLoading = loading;
    await loading.present();
    this.diagnostics.log('boot', 'boot start')

    let detected: boolean;
    try {
      ({ detected } = await this.loadGame(message => {
        // Stencil re-renders on the property write; nothing here needs a change-detection pass.
        if (loading.message !== message) loading.message = message;
      }));
    } catch (e) {
      await this.dismissBootLoading(loading);
      await this.handleBootFailure(e);
      return;
    }

    if (this.destroyed) {
      await this.dismissBootLoading(loading);
      return;
    }

    // The emulator started, so the failures in a row are over, whether or not its screen showed.
    // Its own try: with site data blocked every Ionic Storage write rejects while js-dos itself
    // boots fine, and that must not leave the overlay over a running game.
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
    await this.dismissBootLoading(loading)

    try {
      if (detected) {
        await this.handleShowTutorial()
      } else {
        // A wall of welcome text over a screen that never rendered is worse than silence, but
        // silence is not an answer either: the guest may just be slow.
        console.warn('Game screen was never detected; skipping the welcome dialog.')
        await this.multiplayerUiService.showToast('O jogo ainda está iniciando…', 'warning', 6000)
      }
      await this.consumeHostIntent()
    } catch (e) {
      console.error(e)
      await this.showErrorAlert(e instanceof Error ? e : new Error(String(e)))
    }
    // After the welcome dialog and the room dialog, and not awaited: it waits for the player.
    void this.maybeNudgeBackup()
  }

  private async dismissBootLoading(loading: Awaited<ReturnType<LoadingController['create']>>) {
    if (this.bootLoading === loading) this.bootLoading = undefined;
    await loading.dismiss();
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
    // Not once the page is gone: bootGame() would put a loader nothing dismisses over whatever
    // page is showing now, for as long as the boot stays pending.
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
        text: 'Limpar todos os dados',
        cssClass: 'alert-danger',
        handler: async () => {
          await this.clearAllData()
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
    // Ends the detection loop in waitForGameScreen(); a boot overlay still up would otherwise
    // cover whatever page comes next.
    void this.bootLoading?.dismiss().catch(() => undefined);
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
    this.stopObservingOverlay?.();
    this.multiplayerSubscriptions.unsubscribe();
    // Without this the room, its ping interval and the canvas capture outlive the page.
    this.multiplayerService.leaveRoom();
  }

  /**
   * Boot the emulator and wait for the game's own screen.
   *
   * Returns whether it was actually seen: the polling loop exits both on success and when the
   * window closes, and resolving identically for both meant a failed boot went on to show the
   * welcome dialog over a black screen.
   *
   * `onStatus` hears what the loader should say, in Portuguese: first the download and the
   * unpacking (js-dos's own text, through BootProgressHelper), then the stage the guest is in.
   * A rejection is `elifootMain`'s own: the real error, or a JsdosTimeoutError that is only the
   * end of one wait (see bootGame).
   */
  async loadGame(onStatus?: (message: string) => void): Promise<{ detected: boolean }> {
    const began = performance.now()
    this.dosCI = await elifootMain(environment.prefixPath, environment.gameBundleURL, loaderText => {
      const step = BootProgressHelper.logStep(loaderText)
      if (step !== this.lastLoaderStep) {
        this.lastLoaderStep = step
        this.diagnostics.log('boot', 'js-dos says', () => ({ text: loaderText }))
      }
      const message = BootProgressHelper.describe(loaderText)
      if (message) onStatus?.(message)
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
  private async waitForGameScreen(onStatus?: (message: string) => void): Promise<boolean> {
    const deadline = Date.now() + GAME_BOOT.DETECTION_TIMEOUT_MS
    const began = performance.now()
    const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

    let stage: BootStage = 'dos'
    onStatus?.(BootStageHelper.message(stage))

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
          onStatus?.(BootStageHelper.message(stage))
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
    this.gameDetected = gameDetected
    this.startSafetyNets()
  }

  async handleShowTutorial() {
    const hideTutorial = await this.storageService.get<boolean>(STORAGE_KEY.HIDE_TUTORIAL)

    if (!hideTutorial) {
      await this.showTutorial()
    }
  }

  /**
   * The welcome dialog. Reachable from the menu as "Primeiros passos" as well, so retiring it
   * is not a one-way door.
   *
   * Resolves only once the user is done with it — including the guide, if they went there —
   * because `ngOnInit` runs `consumeHostIntent()` next: awaiting `present()` alone opened the
   * room dialog on top of this alert on every `?host=1` arrival, which is the entry point the
   * landing page's "Jogar e transmitir para amigos" uses.
   */
  async showTutorial() {
    this.hidePopover()
    // Assigned by the FAQ button so this method can wait for that path too.
    let followUp: Promise<void> = Promise.resolve()
    const alert = await this.alertController.create({
      header: 'Informações Importantes',
      message:
        'Este é um projeto gratuito e de código aberto, sem cobranças ou coleta de dados dos usuários.\n' +
        '\nPara aprender a jogar, consulte o FAQ e o Manual do Usuário disponíveis no menu de opções.\n' +
        '\nSobre os jogos salvos:\n' +
        '- Os dados são armazenados localmente no navegador. Se você estiver usando uma janela anônima ou se os dados de navegação forem apagados, os jogos salvos serão perdidos.\n' +
        '\n' +
        'Dicas de uso:\n' +
        '- No computador, pressione ESC para liberar o mouse da janela do jogo.\n' +
        '- No celular, toque direto no que quiser clicar. Toque duas vezes para um clique duplo, arraste para mover barras e janelas, e segure o dedo por meio segundo para mirar com precisão: o cursor aparece acima do dedo e o clique acontece quando você solta.\n' +
        '\nAproveite para reviver a nostalgia do clássico Elifoot 98 diretamente no seu navegador!\n',
      backdropDismiss: false,
      cssClass: 'win9x-alert alert-whitespace wide-alert',
      buttons: [
        {
          text: 'FAQ e Manual',
          handler: () => {
            // `false` because we dismiss it ourselves, in order, before the guide opens.
            followUp = (async () => {
              await alert.dismiss()
              await this.showFAQAndManualModal()
            })()
            return false
          }
        },
        {
          // Acknowledging it IS the "don't show again". The old checkbox only wrote the flag
          // when toggled, so anyone who read the dialog and pressed Entendi got it again on
          // every single launch.
          text: 'Entendi',
          handler: async () => {
            await this.storageService.set(STORAGE_KEY.HIDE_TUTORIAL, true)
          }
        }
      ]
    });
    await alert.present();
    await alert.onDidDismiss();
    await followUp;
  }

  /** Resolves when the guide is closed, so callers can queue something after it. */
  async showFAQAndManualModal() {
    this.hidePopover()
    const modal = await this.modalController.create({
      component: UserGuideComponent,
      backdropDismiss: false
    })
    await modal.present()
    await modal.onDidDismiss()
  }

  async showAboutModal() {
    this.hidePopover()
    const modal = await this.modalController.create({
      component: AboutComponent,
      backdropDismiss: false
    })
    await modal.present()
  }

  /** The diagnostics window: switch, last lines, and the ways to get the report off the device. */
  async showDiagnosticsModal() {
    this.hidePopover()
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
    this.hidePopover()
    const modal = await this.modalController.create({
      component: OmaticModalComponent,
      cssClass: 'omatic-modal',
      backdropDismiss: false
    })
    await modal.present()
  }

  get gameInputs() {
    if (!this.isLandscape) {
      return GAME_INPUT_FN_BTNS_REVERSED;
    } else {
      return GAME_INPUT_FN_BTNS;
    }
  }

  get isLandscape() {
    return this.layoutHelperService.isLandscape
  }

  get isMobile() {
    return this.layoutHelperService.isMobile
  }

  /**
   * Save now: the menu's "Salvar agora" and the toolbar chip. It asks the game first (see
   * SavePolicyHelper): the game's own save dialog being up is not the moment to copy the disk, and
   * the auto-saver takes the copy as soon as it closes, so the answer then is to say so.
   */
  async saveNow() {
    this.hidePopover()
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
    this.hidePopover()
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
  private async maybeNudgeBackup() {
    try {
      if (this.destroyed || !(await this.saveStatus.backupNudgeDue())) return
      // "Dos seus jogos salvos" has to be true: a visit that only looked around persists the layer
      // too, and a reminder answered with nothing to back up would be spent for good.
      if ((await this.patchService.existingSaveNames(this.dosCI)).length === 0) return
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
    } catch (e) {
      console.warn('Could not show the backup reminder', e)
    }
  }

  async downloadFullDiskChanges() {
    const hasSaved = await this.saveGameService.downloadFullDiskChanges(this.dosCI)
    this.hidePopover()
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

  async clearAllData() {
    const alert = await this.alertController.create({
      header: 'Aviso',
      message: 'Tem certeza que deseja limpar todos os dados? Isso irá apagar todos os jogos salvos e configurações.',
      backdropDismiss: false,
      cssClass: 'win9x-alert alert-whitespace',
      buttons: [{
        text: 'Não',
        role: 'cancel'
      }, {
        text: 'Sim',
        handler: async () => {
          // show loading
          const loading = await this.loadingController.create({
            message: 'Limpando dados...',
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

          // clear all data
          await this.saveGameService.clearAllData(this.dosCI)
          // Before the storage is emptied, not after: with the log still on, the reload below
          // fires pagehide, which writes the log's tail back into the storage that was just wiped.
          await this.diagnostics.disable({ persist: false })
          await this.storageService.clearAllData()
          await loading.dismiss()
          this.reloadPage()
        }
      }]
    })
    await alert.present()
  }

  /**
   * The js-dos virtual keyboard and the chat panel are mutually exclusive.
   *
   * Chosen over "position them so they cannot overlap": the keyboard is
   * `position:absolute; bottom:0; left:0; right:0; z-index:999` inside #game-container and
   * js-dos picks its height from its own simple-keyboard layout, so there is no height we
   * could reserve; and on a portrait phone the two together (~287px panel + ~230px
   * keyboard) exceed the whole content area anyway. Mutual exclusion is one boolean;
   * coexistence is unbounded work.
   */
  toggleKeyboard() {
    // Opening the game keyboard closes the chat. No toast in this direction: the user
    // asked for the keyboard and the panel visibly slides away. Routed through toggleChat
    // so focus is handed back to the emulator, which is where the js-dos keyboard wants it.
    if (!this.isVirtualKeyboardShowing && this.isChatOpen) {
      this.toggleChat(false);
    }
    this.isVirtualKeyboardShowing = !this.isVirtualKeyboardShowing
    toggleSoftKeyboard()
    this.hidePopover()
  }

  async setupAutoSave() {
    const disableAutoSave = await this.storageService.get<boolean>(STORAGE_KEY.DISABLE_AUTO_SAVE)
    this.toggleDisableAutoSave({ detail: { checked: disableAutoSave } })
  }

  async toggleDisableAutoSave(e: any) {
    const autoSaveDisabled = e.detail.checked
    this.autoSaveDisabled = autoSaveDisabled
    console.log(`autosave: ${!autoSaveDisabled ? 'on' : 'off'}`)
    await this.storageService.set<boolean>(STORAGE_KEY.DISABLE_AUTO_SAVE, autoSaveDisabled)

    if (autoSaveDisabled) {
      this.autoSaverService.stop()
    } else {
      // A hosting browser keeps playing, and streaming, from a hidden tab, so its ticks go on.
      this.autoSaverService.start(this.dosCI, {
        keepRunningWhileHidden: () => this.multiplayerService.isHosting,
      })
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

  async setupSmoothFilter() {
    const disableSmoothFilter = await this.storageService.get<boolean>(STORAGE_KEY.DISABLE_SMOOTH_FILTER)
    this.toggleSmoothFilter({ detail: { checked: disableSmoothFilter } })
  }

  async setupSpectatorCursors() {
    const hidden = await this.storageService.get<boolean>(STORAGE_KEY.HIDE_SPECTATOR_CURSORS)
    this.spectatorCursorsHidden = !!hidden
  }

  async setupSpectatorAudio() {
    const disabled = await this.storageService.get<boolean>(STORAGE_KEY.DISABLE_SPECTATOR_AUDIO)
    this.spectatorAudioDisabled = !!disabled
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
    await this.storageService.set<boolean>(STORAGE_KEY.DISABLE_SPECTATOR_AUDIO, this.spectatorAudioDisabled)
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

  async toggleSmoothFilter(e: any) {
    const disableSmoothFilter = e.detail.checked
    this.smoothFilterDisabled = disableSmoothFilter
    console.log(`smooth filter: ${!disableSmoothFilter ? 'on' : 'off'}`)

    const canvas = document.getElementsByClassName('emulator-canvas')[0] as HTMLCanvasElement
    if (disableSmoothFilter) {
      canvas.classList.remove('smooth-canvas')
    } else {
      canvas.classList.add('smooth-canvas')
    }
    await this.storageService.set<boolean>(STORAGE_KEY.DISABLE_SMOOTH_FILTER, disableSmoothFilter)
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
    this.hidePopover()
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
    })
  }

  /** The subtitle of the "Modo de toque" entry. */
  get touchModeSummary(): string {
    return TouchModeHelper.label(TouchModeHelper.effective(this.touchMode, navigator.userAgent))
  }

  /** Direct (a tap lands under the finger) or classic (js-dos's touchpad). Applies at once. */
  async promptTouchMode() {
    this.hidePopover()

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

  showPopover(e: Event) {
    this.popover.event = null
    this.popover.event = e;
    this.hidePopover()
    setTimeout(() => {
      this.isPopoverOpen = true;
    }, 50);
  }

  sendKeyWithoutClosingFab(e: Event, key: EmulatorKeyCode) {
    e.stopImmediatePropagation()
    this.sendKey(key)
  }

  sendKey(key: EmulatorKeyCode) {
    console.log(`key pressed: ${key}`)
    this.emulatorControlService.sendKey(this.dosCI, key).catch(error => this.reportKeyFailure(error))
  }

  /**
   * A key that could not be sent says so. Rate-limited because the usual cause (no emulator,
   * or one that has exited) is also what makes the next tap fail, and a dialog per tap would
   * bury the one that matters.
   */
  private reportKeyFailure(error: unknown) {
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
    this.hidePopover()

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
    this.hidePopover()

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
    this.hidePopover()
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
   * iOS edge swipe leave the game without passing through "Voltar ao menu". They get that
   * menu's own dialog instead, once.
   */
  canLeave(currentUrl: string, nextUrl: string): boolean {
    const verdict = NavigationGuardHelper.verdict({
      currentUrl,
      nextUrl,
      leaving: this.leaving || this.destroyed,
      hasEmulator: !!this.dosCI,
      promptOpen: this.leavePromptOpen,
    })
    this.diagnostics.log('page', 'leave guard', () => ({ verdict, to: NavigationGuardHelper.pathOf(nextUrl) }))
    if (verdict === 'prompt') void this.confirmLeaveGame()
    return verdict === 'allow'
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
  }

  /** Detach everything `startSafetyNets` attached. Safe to call twice. */
  private stopSafetyNets() {
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
    this.hidePopover()
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
   * Open the room dialog when arrival asked for it — the landing page's "Jogar e transmitir
   * para amigos" action and the PWA's "Hospedar" shortcut both arrive as `?host=1`.
   *
   * Stripping it is load-bearing, not tidiness: PatchService applies a patch by rewriting the
   * IndexedDB disk image and forcing `window.location.reload()`. With the flag still on the
   * URL, every patch reload — and every failure retry, which also reloads — would re-open this
   * dialog, forever. `replaceUrl` keeps it out of the history too, so Back does not resurrect
   * it either.
   */
  private async consumeHostIntent() {
    if (this.route.snapshot.queryParamMap.get('host') !== '1') return

    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {},
      replaceUrl: true
    })
    await this.promptHostRoom()
  }

  /**
   * Compose a text and type it into whatever the game has focused. Accents work (they are
   * sent as Alt codes, see EmulatorKeyCodeHelper), a line break is an Enter, which is how
   * several fields of a form are filled in one go, and anything the game cannot show is typed
   * as "?".
   */
  async promptInputText() {
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
    this.hidePopover();
    const setup = await this.multiplayerUiService.promptRoomSetup('host', this.hostRoomId);
    if (!setup) return;

    this.hostName = setup.playerName;
    this.hostRoomId = setup.roomCode;
    this.hostPassword = setup.password;
    this.hostColor = setup.playerColor;
    this.hostMaxSpectators = setup.maxSpectators ?? MULTIPLAYER.DEFAULT_MAX_SPECTATORS;

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
    this.hidePopover();
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
    this.isChatOpen = false;
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
    this.hidePopover();
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
   * The panel is always mounted while streaming, so opening it is a state flip plus a
   * focus move — and, if the js-dos keyboard is up, closing that first.
   */
  toggleChat(force?: boolean) {
    const shouldOpen = typeof force === 'boolean' ? force : !this.isChatOpen;
    if (shouldOpen === this.isChatOpen) return;

    if (shouldOpen && this.isVirtualKeyboardShowing) {
      this.hideVirtualKeyboard();
      void this.multiplayerUiService.showToast(
        'Teclado virtual do jogo fechado para abrir o chat.',
        'medium'
      );
    }

    this.isChatOpen = shouldOpen;

    if (shouldOpen) {
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
    this.hidePopover();
    this.toggleChat(true);
  }

  /** Accessible name for the handle, including the unread count. */
  chatToggleLabel(unread: number | null): string {
    return ChatPanelHelper.toggleAriaLabel(this.isChatOpen, unread);
  }

  /**
   * `toggleSoftKeyboard()` flips on the div's *current inline display*, so calling it
   * unconditionally would SHOW an already-hidden keyboard. Branch on our own flag instead.
   */
  private hideVirtualKeyboard() {
    if (!this.isVirtualKeyboardShowing) return;
    this.isVirtualKeyboardShowing = false;
    toggleSoftKeyboard();
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

  private hidePopover() {
    this.isPopoverOpen = false;
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
    this.hidePopover()
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
   * The chat no longer causes that — it is an overlay and changes no box — but these still
   * do: a window resize, a rotation (which also drops the header in mobile landscape,
   * changing ion-content's height), the mobile URL bar collapsing, a fullscreen change, and
   * `isHidden` flipping `.full` on at boot. The js-dos virtual keyboard does NOT:
   * `.emulator-keyboard` is `position:absolute; bottom:0` inside the same root, so it
   * changes no offset box.
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
