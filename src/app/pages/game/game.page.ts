import { Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { AlertController, LoadingController, ModalController } from '@ionic/angular';
import JSZip from 'jszip';
import { environment } from 'src/environments/environment';
import { GAME_INPUT_FN_BTNS, GAME_INPUT_FN_BTNS_REVERSED, MULTIPLAYER, STORAGE_KEY } from '../../core/models/constants';
import { UserGuideComponent } from './components/user-guide/user-guide.component';
import { AboutComponent } from './components/about/about.component';
import { OmaticModalComponent } from './components/omatic-modal/omatic-modal.component';
import { Observable, Subscription } from 'rxjs';
import { EmulatorKeyCode } from '../../core/models/game';
import { CursorClickMessage, CursorPositionMessage, MultiplayerJoinErrorKind } from '../../core/models/multiplayer';
import { AutoSaverService, EmulatorControlService, PatchService, SaveGameService } from '../../core/services/game';
import { LayoutHelperService, LocalStorageService } from '../../core/services/shared';
import { MultiplayerChatService, MultiplayerCursorService, MultiplayerService, MultiplayerUiService } from '../../core/services/multiplayer';
import { CursorRendererHelper } from 'src/app/core/helpers/cursor-renderer.helper';
import { OverlaySyncHelper } from 'src/app/core/helpers/overlay-sync.helper';


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
    private multiplayerService: MultiplayerService,
    private multiplayerCursorService: MultiplayerCursorService,
    private multiplayerUiService: MultiplayerUiService,
    chatService: MultiplayerChatService
  ) {
    this.unreadCount$ = chatService.unreadCount$;
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

  toggleKeyboard() {
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
      await this.showRoomInvite();
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
    await this.multiplayerUiService.showToast(message);
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

  toggleChat(force?: boolean) {
    this.isChatOpen = typeof force === 'boolean' ? force : !this.isChatOpen;
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

  /**
   * Show the room code straight after hosting starts, so the host has something to
   * copy or share without hunting through the menu.
   */
  private async showRoomInvite() {
    const alert = await this.alertController.create({
      header: 'Sala criada!',
      cssClass: 'alert-whitespace',
      message: `Compartilhe este código:\n\n${this.hostRoomId}`,
      buttons: [
        {
          text: 'Copiar link',
          handler: () => {
            this.multiplayerUiService.shareRoom(this.hostRoomId);
          }
        },
        { text: 'Fechar', role: 'cancel' }
      ]
    });
    await alert.present();
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
   * js-dos re-lays-out its canvas whenever `#game-container` changes size, which now
   * happens every time the chat sidebar is toggled. Without observing it the overlay
   * only re-aligns when a cursor message happens to arrive, so it goes stale during a
   * quiet toggle.
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
    }
  }
}
