import { Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertController, LoadingController, ModalController } from '@ionic/angular';
import JSZip from 'jszip';
import { environment } from 'src/environments/environment';
import { GAME_INPUT_FN_BTNS, GAME_INPUT_FN_BTNS_REVERSED, MULTIPLAYER, STORAGE_KEY } from '../../core/models/constants';
import { UserGuideComponent } from './components/user-guide/user-guide.component';
import { AboutComponent } from './components/about/about.component';
import { OmaticModalComponent } from './components/omatic-modal/omatic-modal.component';
import { Observable, Subscription } from 'rxjs';
import { EmulatorKeyCode } from '../../core/models/game';
import { CursorClickMessage, CursorPositionMessage, MultiplayerJoinErrorKind, PlayerInfo } from '../../core/models/multiplayer';
import { AutoSaverService, EmulatorControlService, PatchService, SaveGameService } from '../../core/services/game';
import { LayoutHelperService, LocalStorageService } from '../../core/services/shared';
import { MultiplayerChatService, MultiplayerCursorService, MultiplayerPlayerInfoService, MultiplayerService, MultiplayerUiService } from '../../core/services/multiplayer';
import { CursorRendererHelper } from 'src/app/core/helpers/cursor-renderer.helper';
import { OverlaySyncHelper } from 'src/app/core/helpers/overlay-sync.helper';
import { ChatPanelHelper } from 'src/app/core/helpers/chat-panel.helper';


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
  autoSaveDisabled = false;
  periodicSave = false;
  isPopoverOpen = false;
  isVirtualKeyboardShowing = false;
  isHidden = true;
  debugMode = false
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

  /** Drives the badge on the chat toggle, which sits outside the chat component. */
  unreadCount$: Observable<number>;

  /**
   * Reactive breakpoints for the floating status pill. The synchronous getters below are
   * fine for markup that is re-evaluated anyway, but the pill has to appear and disappear on
   * rotation, which needs an emission.
   */
  isMobile$: Observable<boolean>;
  isLandscape$: Observable<boolean>;

  private multiplayerSubscriptions = new Subscription();
  private stopObservingOverlay?: () => void;

  constructor(
    private loadingController: LoadingController,
    private alertController: AlertController,
    private modalController: ModalController,
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
    chatService: MultiplayerChatService
  ) {
    this.unreadCount$ = chatService.unreadCount$;
    this.isMobile$ = this.layoutHelperService.isMobile$;
    this.isLandscape$ = this.layoutHelperService.isLandscape$;
  }

  async ngOnInit() {
    const loading = await this.loadingController.create({
      message: 'Carregando game...',
      backdropDismiss: false
    });
    await loading.present();

    try {
      console.time("carregando game...")
      await this.loadGame()
      console.timeEnd("carregando game...")
      await this.loadConfig()
      this.isHidden = false
      await loading.dismiss()
      await this.handleShowTutorial()
      await this.storageService.set(STORAGE_KEY.FAIL_COUNT, 0)
      await this.consumeHostIntent()
    } catch (e: any) {
      console.error(e)
      await loading.dismiss()

      let failCount = await this.storageService.get<number>(STORAGE_KEY.FAIL_COUNT) || 0
      failCount += 1
      await this.storageService.set(STORAGE_KEY.FAIL_COUNT, failCount)

      if (failCount < 3) {
        window.location.reload()
      } else {
        const alert = await this.alertController.create({
          header: `É ${failCount} papapá...`,
          cssClass: 'alert-whitespace',
          message: `Multiplas tentativas(${failCount}) de carregar o jogo falharam\n\nMotivo: (${e.message})`,
          backdropDismiss: false,
          buttons: [
            {
              text: 'Tentar novamente',
              handler: () => {
                window.location.reload()
              }
            }, {
              text: 'Limpar todos os dados',
              cssClass: 'alert-danger',
              handler: async () => {
                await this.clearAllData()
              }
            }
          ],
        });
        await alert.present();
      }
    }
  }

  ngOnDestroy(): void {
    this.stopObservingOverlay?.();
    this.multiplayerSubscriptions.unsubscribe();
    // Without this the room, its ping interval and the canvas capture outlive the page.
    this.multiplayerService.leaveRoom();
  }

  async loadGame(): Promise<void> {
    this.dosCI = await elifootMain(environment.prefixPath, environment.gameBundleURL)
    let timeout = false
    let loaded = false
    setTimeout(() => {
      timeout = true
    }, 10000);

    // Properly detect the green screen of the game
    const getColorAt = (x: number, y: number, imageData: ImageData) => {
      const { data, width } = imageData;
      const index = (y * width + x) * 4;

      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const a = data[index + 3];

      return { r, g, b, a }; // or return as rgba string if you prefer
    }

    const checkGreenScreen = async () => {
      try {
        const imageData: ImageData = await this.dosCI.screenshot()
        const points = [
          { x: 0, y: 25 },
          { x: 200, y: 25 },
          { x: 400, y: 25 },
          { x: 10, y: 250 },
        ]

        const expectedGreens = [{ r: 0, g: 128, b: 0, a: 255 }, { r: 0, g: 170, b: 85, a: 255 }]
        const tolerance = 25 // Adjust this value as needed (depends on the color range of the monitor)
        let greenCount = 0
        for (const expectedGreen of expectedGreens) {
          for (const point of points) {
            const color = getColorAt(point.x, point.y, imageData)
            // Check if the color is within the tolerance range
            if (
              Math.abs(color.r - expectedGreen.r) <= tolerance &&
              Math.abs(color.g - expectedGreen.g) <= tolerance &&
              Math.abs(color.b - expectedGreen.b) <= tolerance &&
              Math.abs(color.a - expectedGreen.a) <= tolerance
            ) {
              // Color is within the tolerance range
              greenCount++
            }
          }
        }

        if (greenCount > 2) {
          console.log("Green check passed")
          return true
        }
      } catch (e) {
        console.warn("Error checking green screen", { reason: e })
      }
      return false
    }

    // wait 500ms for the js-dos to settle
    await new Promise(resolve => setTimeout(resolve, 500))
    while (!timeout && !loaded) {
      const isGreenScreen = await checkGreenScreen()
      if (isGreenScreen) {
        console.log("jogo carregado")
        loaded = true
      } else {
        console.log("aguardando o jogo carregar...")
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  async loadConfig() {
    this.setupSmoothFilter()
    this.setupAutoSave()
    this.setupPeriodicSave()
  }

  async handleShowTutorial() {
    const hideTutorial = await this.storageService.get<boolean>(STORAGE_KEY.HIDE_TUTORIAL)

    if (!hideTutorial) {
      await this.showTutorial()
    }
  }

  async showTutorial() {
    const hideTutorial = await this.storageService.get<boolean>(STORAGE_KEY.HIDE_TUTORIAL)
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
        '- No celular, mova o cursor deslizando o dedo na tela, como em um touchpad de notebook.\n' +
        '\nAproveite para reviver a nostalgia do clássico Elifoot 98 diretamente no seu navegador!\n',
      backdropDismiss: false,
      cssClass: 'alert-whitespace wide-alert',
      buttons: [
        {
          text: 'FAQ e Manual',
          handler: async () => {
            await alert.dismiss()
            await this.showFAQAndManualModal()
          }
        },
        {
          text: 'Entendi'
        }
      ],
      inputs: [{
        type: 'checkbox',
        label: 'Não mostrar novamente',
        value: 'showTutorial',
        checked: hideTutorial,
        handler: async (e) => {
          await this.storageService.set(STORAGE_KEY.HIDE_TUTORIAL, e.checked)
        }
      }]
    });
    await alert.present();
  }

  async showFAQAndManualModal() {
    this.hidePopover()
    const modal = await this.modalController.create({
      component: UserGuideComponent,
      backdropDismiss: false
    })
    await modal.present()
  }

  async showAboutModal() {
    this.hidePopover()
    const modal = await this.modalController.create({
      component: AboutComponent,
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

  async saveGame() {
    await this.saveGameService.saveGame()
    this.hidePopover()
  }

  async downloadGameSaves() {
    const hasSaved = await this.saveGameService.downloadGameSaves(this.dosCI)
    this.hidePopover()
    if (!hasSaved) {
      const alert = await this.alertController.create({
        header: 'Aviso',
        message: 'Não há jogos salvos para baixar',
        backdropDismiss: false,
        buttons: ['OK']
      });
      await alert.present();
    }
  }

  async importGameSaves() {

  }

  async downloadFullDiskChanges() {
    const hasSaved = await this.saveGameService.downloadFullDiskChanges(this.dosCI)
    this.hidePopover()
    if (!hasSaved) {
      const alert = await this.alertController.create({
        header: 'Aviso',
        message: 'Não há alterações no disco para baixar',
        backdropDismiss: false,
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
      cssClass: 'alert-whitespace',
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

          // clear all data
          await this.saveGameService.clearAllData(this.dosCI)
          await this.storageService.clearAllData()
          await loading.dismiss()
          window.location.reload()
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
      this.autoSaverService.start(this.dosCI)
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
    this.emulatorControlService.sendKey(this.dosCI, key)
  }

  async applyPatch(patch: JSZip) {
    this.autoSaverService.stop()
    this.autoSaverService.stopPeriodicSave()

    const loading = await this.loadingController.create({
      message: 'Aplicando patch...',
      backdropDismiss: false
    });
    await loading.present();
    try {
      await this.saveGameService.saveGame()
      await this.patchService.applyPatch(this.dosCI, patch)
      await loading.dismiss()
      const alert = await this.alertController.create({
        header: 'Patch aplicado',
        message: 'O patch foi aplicado com sucesso.\nO jogo será reiniciado.',
        cssClass: 'alert-whitespace',
        backdropDismiss: false,
        buttons: [{
          text: 'Recarregar',
          handler: async () => {
            window.location.reload()
          }
        }]
      });
      await alert.present();
      await this.dosCI.exit()
    } catch (e: any) {
      console.error(e)
      await this.showErrorAlert(e)
    }

  }

  async promptClearCustomPatch() {
    const alert = await this.alertController.create({
      header: 'Aviso',
      message: 'Tem certeza que deseja remover o patch customizado? \nOs times e bandeiras serão revertidos ao estado original',
      backdropDismiss: false,
      cssClass: 'alert-whitespace',
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

  async onSaveFileSelected(e: any) {
    const file: File = e.target.files[0]
    console.log("Save file selected", { file })
    this.hidePopover()

    const loading = await this.loadingController.create({
      message: 'Validando arquivos...',
      backdropDismiss: false
    });
    await loading.present();

    try {
      const patch = await this.patchService.prepareSaveFilePatch(file)
      await loading.dismiss()
      const alert = await this.alertController.create({
        header: 'Aviso',
        message: `Se já existir um arquivo com o mesmo nome do save, ele será substituído.\nDeseja continuar?`,
        backdropDismiss: false,
        cssClass: 'alert-whitespace',
        buttons: [{
          text: 'Não',
          role: 'cancel'
        }, {
          text: 'Sim',
          handler: async () => {
            await this.applySaveGamePatch(patch)
          }
        }]
      });
      await alert.present();
    } catch (e: any) {
      console.error(e)
      await loading.dismiss()
      await this.showErrorAlert(e)
    }
  }

  async onPatchFileSelected(e: any) {
    const file: File = e.target.files[0]
    console.log("Patch File selected", { file })
    this.hidePopover()
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
        cssClass: 'alert-whitespace',
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
  }

  async confirmRefresh() {
    const alert = await this.alertController.create({
      header: 'Aviso',
      message: 'Tem certeza que deseja recarregar o jogo? \n\nO progresso que não foi salvo, será perdido.',
      backdropDismiss: false,
      cssClass: 'alert-whitespace',
      buttons: [{
        text: 'Cancelar',
        role: 'cancel'
      }, {
        text: 'Recarregar',
        handler: async () => {
          window.location.reload()
        }
      }]
    })
    await alert.present()
  }

  /**
   * Leave the game and go back to the landing page.
   *
   * `/game` had no exit at all, which is why the installed PWA could never reach spectator
   * mode: it opened straight into the emulator and stayed there.
   */
  async confirmLeaveGame() {
    this.hidePopover()
    const alert = await this.alertController.create({
      header: 'Voltar ao menu?',
      message: this.isStreaming
        ? 'O jogo será salvo e a sala será encerrada. Os espectadores serão desconectados.'
        : 'O jogo será salvo antes de sair.',
      cssClass: 'alert-whitespace',
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
    await alert.present()
  }

  /**
   * Full teardown, in an order that matters.
   *
   * The tickers stop first: the auto-saver OCRs the framebuffer every 1.5s and would
   * otherwise fire a persist into a VM that is already exiting. The room is left explicitly
   * so spectators get a clean departure instead of waiting out a grace period on a host that
   * simply vanished. Only then is the disk flushed and the emulator told to exit.
   */
  private async leaveGameToMenu() {
    const loading = await this.loadingController.create({
      message: 'Salvando e saindo...',
      backdropDismiss: false
    })
    await loading.present()

    try {
      this.autoSaverService.stop()
      this.autoSaverService.stopPeriodicSave()
      this.stopObservingOverlay?.()
      this.multiplayerService.leaveRoom()
      await this.saveGameService.saveGame()
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

  async promptInputText() {
    const placeholders = [
      'Tite\nFelipao\nParreira',
      'Ronaldo',
      'Hristo',
      'Lukunku',
      'Denilson',
      'Taffarel',
      'Peter Schemichel',
      'Roberto Carlos',
      'Bosco',
      'Zinedine Zidane',
      'Rui Costa',
      'Mirandinha',
      'Batistuta'
    ]

    const randomIndex = Math.floor(Math.random() * placeholders.length);
    const randomPlaceholder = placeholders[randomIndex]

    const alert = await this.alertController.create({
      header: 'Input',
      message: 'Digite o texto que deseja enviar para o jogo',
      backdropDismiss: false,
      cssClass: 'alert-whitespace wide-alert',
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
        handler: async (data) => {
          const text = data.text
          if (text) {
            this.emulatorControlService.sendString(this.dosCI, text)
          }
        }
      }]
    })
    await alert.present()
  }

  async promptHostRoom() {
    this.hidePopover();
    const setup = await this.multiplayerUiService.promptRoomSetup('host', this.hostRoomId);
    if (!setup) return;

    this.hostName = setup.playerName;
    this.hostRoomId = setup.roomCode;
    this.hostPassword = setup.password;
    this.hostColor = setup.playerColor;

    await this.startHosting();
  }

  async startHosting() {
    this.isHosting = true;
    const loading = await this.loadingController.create({ message: 'Criando sala e iniciando streaming...' });
    await loading.present();

    let hostingError: Error | undefined;
    try {
      const stream = await this.captureGameCanvasStream();
      await this.multiplayerService.hostGameRoom(
        this.hostName,
        this.hostRoomId,
        this.hostPassword,
        stream,
        this.hostColor
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
    } else {
      // A toast, not the old blocking "Sala criada!" alert: the status pill carries the
      // code for as long as the room is up, so nothing has to be memorised before
      // dismissing anything.
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

    const alert = await this.alertController.create({
      header: 'Código de sala já em uso',
      cssClass: 'alert-whitespace',
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
      : 'Alguém tentou entrar, mas a conexão não foi estabelecida.';
    // 'warning', not the default green: a failed entry attempt is not good news.
    await this.multiplayerUiService.showToast(message, 'warning');
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

  async showParticipants() {
    this.hidePopover();
    await this.multiplayerUiService.showParticipants();
  }

  async shareRoom() {
    this.hidePopover();
    await this.multiplayerUiService.shareRoom(this.hostRoomId);
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

  private async showErrorAlert(errorMsg: Error) {
    const alert = await this.alertController.create({
      header: 'Erro',
      message: errorMsg.message,
      backdropDismiss: false,
      buttons: ['OK']
    });
    await alert.present();
  }

  private async clearCustomPatch() {
    this.hidePopover()
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
        buttons: [{
          text: 'Recarregar',
          handler: async () => {
            window.location.reload()
          }
        }]
      })
      await alert.present()

      await this.dosCI.exit()
    } catch (e: any) {
      console.error(e)
      await loading.dismiss()
      await this.showErrorAlert(e)
    }
  }

  private async applySaveGamePatch(patch: JSZip) {
    const loading = await this.loadingController.create({
      message: 'Aplicando jogo salvo...',
      backdropDismiss: false
    });
    await loading.present();

    try {
      await this.patchService.applySaveFilePatch(this.dosCI, patch)
      await loading.dismiss()
      const alert = await this.alertController.create({
        header: 'Jogo salvo aplicado',
        message: 'O jogo salvo foi aplicado com sucesso.\nO jogo será reiniciado.',
        cssClass: 'alert-whitespace',
        backdropDismiss: false,
        buttons: [{
          text: 'Recarregar',
          handler: async () => {
            window.location.reload()
          }
        }]
      });
      await alert.present();
      await this.dosCI.exit()
    } catch (e: any) {
      console.error(e)
      await loading.dismiss()
      await this.showErrorAlert(e)
    }
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
    const overlay = this.getOverlayElement();
    if (!overlay) return;
    CursorRendererHelper.renderCursors(overlay, cursors);
  }

  private renderClick(click: CursorClickMessage) {
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
