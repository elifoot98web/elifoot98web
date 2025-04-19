import { Component, OnInit, ViewChild } from '@angular/core';
import { AlertController, LoadingController, MenuController } from '@ionic/angular';
import { SaveGameService } from '../services/save-game.service';
import { LocalStorageService } from '../services/local-storage.service';
import { PatchService } from '../services/patch.service';
import * as JSZip from 'jszip';

@Component({
  selector: 'app-game',
  templateUrl: './game.page.html',
  styleUrls: ['./game.page.scss'],
})
export class GamePage implements OnInit {
  @ViewChild('popover') popover: any;
  
  smoothFilterActive = false;
  isPopoverOpen = false;
  isHidden = true;
  dosCI: any = null;
  autoSaveInterval: any = null;

  // Mapeamento de teclas para seus códigos
  private keyMap: { [key: string]: number } = {
    'F1': 0x3B,  // 59 - Formação 3-3-4
    'F2': 0x3C,  // 60 - Formação 3-4-3
    'F3': 0x3D,  // 61 - Formação 4-2-4
    'F4': 0x3E,  // 62 - Formação 4-3-3
    'F5': 0x3F,  // 63 - Formação 4-4-2
    'F6': 0x40,  // 64 - Formação 4-5-1
    'F7': 0x41,  // 65 - Formação 5-3-2
    'F8': 0x42,  // 66 - Formação 5-4-1
    'F9': 0x43,  // 67 - Formação 5-5-0
    'F10': 0x44, // 68 - Formação 6-3-1
    'F11': 0x85, // 133 - Formação 6-4-0
    'A': 0x41,   // 65 - Automático
    'M': 0x4D    // 77 - Melhores
  };

  constructor(
    private loadingController: LoadingController, 
    private alertController: AlertController, 
    private saveGameService: SaveGameService,
    private patchService: PatchService,
    private storageService: LocalStorageService,
    private menuController: MenuController
  ) { }

  async ngOnInit() {
    const loading = await this.loadingController.create({
      message: 'Carregando game...',
      backdropDismiss: false
    });
    await loading.present();
    console.time("carregando game...")
    this.dosCI = await elifootMain()
    console.timeEnd("carregando game...")
    setTimeout(async () => {
      this.isHidden = false
      await loading.dismiss()
      await this.handleShowTutorial()
    }, 1500);
  }

  async handleShowTutorial() {
    const hideTutorial = await this.storageService.get<boolean>('hideTutorial')

    if (!hideTutorial) {
      await this.showTutorial()
    }
  }

  async showTutorial() {
      const alert = await this.alertController.create({
        header: 'Avisos',
        message: '- Sempre que terminar de jogar, clique no botão "Salvar Progresso" no topo do site para persistir o jogo salvo neste navegador\n' +
          '- O jogo salvo é persistido no cache navegador, então se você limpar o cache do navegador, o jogo salvo será perdido\n' +
          '- Caso um erro de "eli.cod" apareça, recarregue a página até que ele suma. Estou tentando consertar.\n' +
          '- Pressione ESC para livrar o mouse da janela do jogo.\n' +
          '- Por conta de como o Elifoot 98 verifica a integridade do registro, não é possível salvar o registro no emulador web da aplicação entre sessões diferentes do navegador. É necessário registrar novamente sempre que necessario.\n' +
          '- Jogar no celular ainda não está 100% por conta da emulação do mouse e teclado. O android também sofre um pouco mais severamente com o problema do "eli.cod". Estou verificando alternativas.\n',
        backdropDismiss: false,
        cssClass: 'alert-whitespace wide-alert',
        buttons: [{
          text: 'Entendi',
          handler: () => {
            this.isHidden = false
          }
        }],
        inputs: [{
          type: 'checkbox',
          label: 'Não mostrar novamente',
          value: 'showTutorial',
          checked: false,
          handler: async (e) => {
            await this.storageService.set('hideTutorial', e.checked)
          }
        }]
      });
      await alert.present();
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
  
  toggleKeyboard() {
    toggleSoftKeyboard()
    this.hidePopover()
  }

  async toggleAutoSave(e: any) {
    console.log(`autosave: ${e.detail.checked ? 'on' : 'off'}`)
    clearInterval(this.autoSaveInterval)
    if (e.detail.checked) {
      this.autoSaveInterval = setInterval(async () => {
        await this.saveGameService.saveGame()
      }, 5*60*1000)
      await this.saveGameService.saveGame()
    }
  }

  async toggleSmoothFilter(e: any) {
    const activateSmoothFilter = e.detail.checked
    this.smoothFilterActive = activateSmoothFilter
    console.log(`smooth filter: ${activateSmoothFilter ? 'on' : 'off'}`)

    const canvas = document.getElementsByClassName('emulator-canvas')[0] as HTMLCanvasElement
    if(activateSmoothFilter) {
      canvas.classList.add('smooth-canvas')
    } else {
      canvas.classList.remove('smooth-canvas')
    }
  }

  showPopover(e: Event) {
    this.popover.event = null
    this.popover.event = e;
    this.hidePopover()
    setTimeout(() => {
      this.isPopoverOpen = true;
    }, 50);
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
      this.patchService.clearPatch(this.dosCI)
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

  async toggleSidebar() {
    const menu = await this.menuController.get('landscape-menu');
    if (menu) {
      menu.toggle();
    }
  }

  async toggleFormationsMenu() {
    const menu = await this.menuController.get('formations-menu');
    if (menu) {
      menu.toggle();
    }
  }

  async simulateKey(key: string) {
    if (this.dosCI && this.keyMap[key]) {
      this.dosCI.simulateKeyPress(this.keyMap[key]);
      const menu = await this.menuController.get('formations-menu');
      if (menu) {
        menu.close();
      }
    }
  }
}
