import { Component, HostListener, OnInit, ViewChild } from '@angular/core';
import { AlertController, LoadingController } from '@ionic/angular';
import { SaveGameService } from '../services/save-game.service';
import { LocalStorageService } from '../services/local-storage.service';
import { PatchService } from '../services/patch.service';
import * as JSZip from 'jszip';
import { environment } from 'src/environments/environment';
import { ToggleCheckEvent } from '../models/toggle-event';
import { EmulatorKeyCode } from '../models/emulator-keycodes';
import { EmulatorControlService } from '../services/emulator-control.service';

const STORAGEKEY = {
  DISABLE_SMOOTH_FILTER: 'disableSmoothFilter',
  AUTO_SAVE: 'autoSave',
  HIDE_TUTORIAL: 'hideTutorial'
}

const gameInputButtons = [
  { keyCode: EmulatorKeyCode.KBD_f1, label: '3-3-4', text: 'F1' },
  { keyCode: EmulatorKeyCode.KBD_f2, label: '3-4-3', text: 'F2' },
  { keyCode: EmulatorKeyCode.KBD_f3, label: '4-2-4', text: 'F3' },
  { keyCode: EmulatorKeyCode.KBD_f4, label: '4-3-3', text: 'F4' },
  { keyCode: EmulatorKeyCode.KBD_f5, label: '4-4-2', text: 'F5' },
  { keyCode: EmulatorKeyCode.KBD_f6, label: '4-5-1', text: 'F6' },
  { keyCode: EmulatorKeyCode.KBD_f7, label: '5-2-3', text: 'F7' },
  { keyCode: EmulatorKeyCode.KBD_f8, label: '5-3-2', text: 'F8' },
  { keyCode: EmulatorKeyCode.KBD_f9, label: '5-4-1', text: 'F9' },
  { keyCode: EmulatorKeyCode.KBD_f10, label: '5-5-0', text: 'F10' },
  { keyCode: EmulatorKeyCode.KBD_f11, label: '6-3-1', text: 'F11' },
  { keyCode: EmulatorKeyCode.KBD_f12, label: '6-4-0', text: 'F12' },
];

const gameInputButtonsReversed = [
  { keyCode: EmulatorKeyCode.KBD_f12, label: '6-4-0', text: 'F12' },
  { keyCode: EmulatorKeyCode.KBD_f11, label: '6-3-1', text: 'F11' },
  { keyCode: EmulatorKeyCode.KBD_f10, label: '5-5-0', text: 'F10' },
  { keyCode: EmulatorKeyCode.KBD_f9, label: '5-4-1', text: 'F9' },
  { keyCode: EmulatorKeyCode.KBD_f8, label: '5-3-2', text: 'F8' },
  { keyCode: EmulatorKeyCode.KBD_f7, label: '5-2-3', text: 'F7' },
  { keyCode: EmulatorKeyCode.KBD_f6, label: '4-5-1', text: 'F6' },
  { keyCode: EmulatorKeyCode.KBD_f5, label: '4-4-2', text: 'F5' },
  { keyCode: EmulatorKeyCode.KBD_f4, label: '4-3-3', text: 'F4' },
  { keyCode: EmulatorKeyCode.KBD_f3, label: '4-2-4', text: 'F3' },
  { keyCode: EmulatorKeyCode.KBD_f2, label: '3-4-3', text: 'F2' },
  { keyCode: EmulatorKeyCode.KBD_f1, label: '3-3-4', text: 'F1' },
];

@Component({
  selector: 'app-game',
  templateUrl: './game.page.html',
  styleUrls: ['./game.page.scss'],
})
export class GamePage implements OnInit {
  EmulatorKeyCode = EmulatorKeyCode
  @ViewChild('popover') popover: any;
  @HostListener('window:resize', ['$event'])
  onWindowResize() {
    this.isLandscape = window.innerWidth > window.innerHeight
    this.isMobile = this.isLandscape && window.innerHeight < 768 || window.innerWidth < 768 
    console.log({isLandscape: this.isLandscape, isMobile: this.isMobile})
  }

  smoothFilterDisabled = false;
  isPopoverOpen = false;
  isVirtualKeyboardShowing = false;
  isHidden = true;
  dosCI: any = null;
  autoSaveInterval: any = null;
  isLandscape = false
  isMobile = false

  constructor(private loadingController: LoadingController, 
    private alertController: AlertController, 
    private saveGameService: SaveGameService,
    private patchService: PatchService,
    private storageService: LocalStorageService,
    private emulatorControlService: EmulatorControlService) { }

  async ngOnInit() {
    this.onWindowResize()
    const loading = await this.loadingController.create({
      message: 'Carregando game...',
      backdropDismiss: false
    });
    await loading.present();
    console.time("carregando game...")
    await this.loadGame()
    console.timeEnd("carregando game...")
    await this.loadConfig()
    this.isHidden = false
    await loading.dismiss()
    await this.handleShowTutorial()
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
      const imageData = await this.dosCI.screenshot()
      const points = [
        { x: 0, y: 25 },
        { x: 200, y: 25 },
        { x: 400, y: 25 },
        { x: 10, y: 250 },
      ]

      const expectedGreen = { r: 0, g: 130, b: 0, a: 255 }

      let greenCount = 0
      for (const point of points) {
        const color = getColorAt(point.x, point.y, imageData)
        if (color.r === expectedGreen.r && color.g === expectedGreen.g && color.b === expectedGreen.b && color.a === expectedGreen.a) {
          greenCount++
        }
      }
      
      if(greenCount > 2) {
        return true
      }
      return false
    }

    while(!timeout && !loaded) {
      const isGreenScreen = await checkGreenScreen()
      if(isGreenScreen) {
        console.log("jogo carregado")
        loaded = true
      } else {
        console.log("aguardando o jogo carregar...")
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  async loadConfig() {
    const disableSmoothFilter = await this.storageService.get<boolean>(STORAGEKEY.DISABLE_SMOOTH_FILTER)
    const autoSave = await this.storageService.get<boolean>(STORAGEKEY.AUTO_SAVE)
    
    this.toggleSmoothFilter({detail: {checked: disableSmoothFilter}})

    if (autoSave) {
      this.toggleAutoSave({detail: {checked: autoSave}})
    }
  }

  async handleShowTutorial() {
    const hideTutorial = await this.storageService.get<boolean>(STORAGEKEY.HIDE_TUTORIAL)

    if (!hideTutorial) {
      await this.showTutorial()
    }
  }

  async showTutorial() {
      const hideTutorial = await this.storageService.get<boolean>(STORAGEKEY.HIDE_TUTORIAL)
      const alert = await this.alertController.create({
        header: 'Informações',
        message: 'Salvando o progresso:\n' +
          '- Sempre que terminar de jogar, clique no botão "Salvar Progresso" no topo do site para persistir o jogo salvo neste navegador\n' +
          '- O jogo salvo é persistido 100% no armazenamento do browser.\n'+
          '- No menu de opções, é possível ativar a opção de auto-save a cada 5 minutos.\n'+
          '- Se os dados do navegador forem apagados ao fim da sessão, ou se estiver rodando em uma janela anônima de navegação o jogo salvo será perdido entre sessões\n' +
          '\n'+
          'Input:\n'+
          '- No computador, pressione ESC para livrar o mouse da janela do jogo.\n' +
          '- No celular, o cursor pode ser movido com o dedo como se a tela toda fosse um grande touchpad de notebook.\n' +
          '- O teclado virtual pode ser aberto e fechado clicando no botão de teclado aqui do lado.\n' +
          '- Os navegadores no sistema Android sofrem um pouco mais com a performance.\n' +
          '- Jogar no celular ainda não está 100% por conta da emulação do mouse e teclado, mas já estou pensando numa solução.\n',
        backdropDismiss: false,
        cssClass: 'alert-whitespace wide-alert',
        buttons: [{
          text: 'Entendi'
        }],
        inputs: [{
          type: 'checkbox',
          label: 'Não mostrar novamente',
          value: 'showTutorial',
          checked: hideTutorial,
          handler: async (e) => {
            await this.storageService.set(STORAGEKEY.HIDE_TUTORIAL, e.checked)
          }
        }]
      });
      await alert.present();
  }

  get gameInputs() {
    if (!this.isLandscape) {
      return gameInputButtonsReversed
    } else {
      return gameInputButtons;
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

  async toggleAutoSave(e: any & ToggleCheckEvent) {
    console.log(`autosave: ${e.detail.checked ? 'on' : 'off'}`)
    clearInterval(this.autoSaveInterval)
    if (e.detail.checked) {
      this.autoSaveInterval = setInterval(async () => {
        await this.saveGameService.saveGame()
      }, 5*60*1000)
      await this.saveGameService.saveGame()
    }
    await this.storageService.set(STORAGEKEY.AUTO_SAVE, e.detail.checked)
  }

  async toggleSmoothFilter(e: any) {
    const disableSmoothFilter = e.detail.checked
    this.smoothFilterDisabled = disableSmoothFilter
    console.log(`smooth filter: ${!disableSmoothFilter ? 'on' : 'off'}`)

    const canvas = document.getElementsByClassName('emulator-canvas')[0] as HTMLCanvasElement
    if(disableSmoothFilter) {
      canvas.classList.remove('smooth-canvas')
    } else {
      canvas.classList.add('smooth-canvas')
    }
    await this.storageService.set(STORAGEKEY.DISABLE_SMOOTH_FILTER, disableSmoothFilter)
  }

  showPopover(e: Event) {
    this.popover.event = null
    this.popover.event = e;
    this.hidePopover()
    setTimeout(() => {
      this.isPopoverOpen = true;
    }, 50);
  }

  sendKey(key: EmulatorKeyCode) {
    console.log(`key pressed: ${key}`)
    this.emulatorControlService.sendKey(this.dosCI, key)
  }

  async applyPatch(patch: JSZip) {
    clearInterval(this.autoSaveInterval)
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

  async onPatchFileSelected(e: any) {
    const file: File = e.target.files[0]
    console.log("oopa", {file})
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
}
