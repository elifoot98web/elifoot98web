import { Component, HostListener, OnInit, ViewChild } from '@angular/core';
import { AlertController, LoadingController, ModalController } from '@ionic/angular';
import { SaveGameService } from '../services/save-game.service';
import { LocalStorageService } from '../services/local-storage.service';
import { PatchService } from '../services/patch.service';
import JSZip from 'jszip';
import { environment } from 'src/environments/environment';
import { ToggleCheckEvent } from '../models/toggle-event';
import { EmulatorKeyCode } from '../models/emulator-keycodes';
import { EmulatorControlService } from '../services/emulator-control.service';
import { GAME_INPUT_FN_BTNS, GAME_INPUT_FN_BTNS_REVERSED, STORAGE_KEY } from '../models/constants';
import { AutoSaverService } from '../services/auto-saver.service';
import { UserGuideComponent } from './components/user-guide/user-guide.component';


@Component({
    selector: 'app-game',
    templateUrl: './game.page.html',
    styleUrls: ['./game.page.scss'],
    standalone: false
})
export class GamePage implements OnInit {
  EmulatorKeyCode = EmulatorKeyCode
  @ViewChild('popover') popover: any;
  @HostListener('window:resize', ['$event'])
  onWindowResize() {
    this.isLandscape = window.innerWidth > window.innerHeight
    this.isMobile = this.isLandscape && window.innerHeight < 768 || window.innerWidth < 768
  }

  // UI state properties
  smoothFilterDisabled = false;
  autoSaveDisabled = false;
  periodicSave = false;
  isPopoverOpen = false;
  isVirtualKeyboardShowing = false;
  isHidden = true;
  isLandscape = false
  isMobile = false
  debugMode = false
  dosCI: any = null;

  constructor(private loadingController: LoadingController,
    private alertController: AlertController,
    private modalController: ModalController,
    private saveGameService: SaveGameService,
    private patchService: PatchService,
    private storageService: LocalStorageService,
    private emulatorControlService: EmulatorControlService,
    private autoSaverService: AutoSaverService) { }

  async ngOnInit() {
    this.onWindowResize()
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
    const hideTutorial = false //await this.storageService.get<boolean>(STORAGE_KEY.HIDE_TUTORIAL)

    if (!hideTutorial) {
      await this.showTutorial()
    }
  }

  async showTutorial() {
    this.hidePopover()
    const modal = await this.modalController.create({
      component: UserGuideComponent,
      cssClass: 'user-guide-modal',
      backdropDismiss: false
    })
    await modal.present()
    // const hideTutorial = await this.storageService.get<boolean>(STORAGE_KEY.HIDE_TUTORIAL)
    // const alert = await this.alertController.create({
    //   header: 'Informações',
    //   message: 'Salvando o progresso:\n' +
    //     '- Sempre que terminar de jogar, clique no botão "Salvar Progresso" no topo do site para persistir o jogo salvo neste navegador\n' +
    //     '- O jogo salvo é persistido 100% no armazenamento do browser.\n' +
    //     '- No menu de opções, é possível ativar a opção de auto-save a cada 5 minutos.\n' +
    //     '- Se os dados do navegador forem apagados ao fim da sessão, ou se estiver rodando em uma janela anônima de navegação o jogo salvo será perdido entre sessões\n' +
    //     '\n' +
    //     'Input:\n' +
    //     '- No computador, pressione ESC para livrar o mouse da janela do jogo.\n' +
    //     '- No celular, o cursor pode ser movido com o dedo como se a tela toda fosse um grande touchpad de notebook.\n' +
    //     '- O teclado virtual pode ser aberto e fechado clicando no botão de teclado aqui do lado.\n' +
    //     '- Os navegadores no sistema Android sofrem um pouco mais com a performance.\n' +
    //     '- Jogar no celular ainda não está 100% por conta da emulação do mouse e teclado, mas já estou pensando numa solução.\n',
    //   backdropDismiss: false,
    //   cssClass: 'alert-whitespace wide-alert',
    //   buttons: [{
    //     text: 'Entendi'
    //   }],
    //   inputs: [{
    //     type: 'checkbox',
    //     label: 'Não mostrar novamente',
    //     value: 'showTutorial',
    //     checked: hideTutorial,
    //     handler: async (e) => {
    //       await this.storageService.set(STORAGE_KEY.HIDE_TUTORIAL, e.checked)
    //     }
    //   }]
    // });
    // await alert.present();
  }

  async showUserGuideModal() {
    const modal = await this.modalController.create({
      component: UserGuideComponent,
      backdropDismiss: false
    });
    await modal.present();
  }

  get gameInputs() {
    if (!this.isLandscape) {
      return GAME_INPUT_FN_BTNS_REVERSED;
    } else {
      return GAME_INPUT_FN_BTNS;
    }
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

  async toggleDisableAutoSave(e: any & ToggleCheckEvent) {
    const autoSaveDisabled = e.detail.checked
    this.autoSaveDisabled = autoSaveDisabled
    console.log(`autosave: ${!autoSaveDisabled ? 'on' : 'off'}`)
    await this.storageService.set<boolean>(STORAGE_KEY.DISABLE_AUTO_SAVE, autoSaveDisabled)

    if(autoSaveDisabled) {
      this.autoSaverService.stop()
    } else {
      this.autoSaverService.start(this.dosCI)
    }
  }

  async setupPeriodicSave() {
    const periodicSave = await this.storageService.get<boolean>(STORAGE_KEY.PERIODIC_SAVE)
    if(periodicSave) {
      this.togglePeriodicSave({ detail: { checked: periodicSave } })
    }
  }

  async togglePeriodicSave(e: any & ToggleCheckEvent) {
    const checked = e.detail.checked
    this.periodicSave = checked
    await this.storageService.set<boolean>(STORAGE_KEY.PERIODIC_SAVE, this.periodicSave)
    if(checked) {
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
}
