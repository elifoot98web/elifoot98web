import { Component, OnInit, ViewChild } from '@angular/core';
import { AlertController, LoadingController } from '@ionic/angular';
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

  isPopoverOpen = false;
  isHidden = true;
  dosCI: any = null;
  autoSaveInterval: any = null;

  constructor(private loadingController: LoadingController, 
    private alertController: AlertController, 
    private saveGameService: SaveGameService,
    private patchService: PatchService,
    private storageService: LocalStorageService) { }

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
        cssClass: 'alert-whitespace',
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
    this.isPopoverOpen = false;
  }

  async downloadGameSaves() {
    const hasSaved = await this.saveGameService.downloadGameSaves(this.dosCI)
    this.isPopoverOpen = false;
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
  
  toggleKeyboard() {
    toggleSoftKeyboard()
    this.isPopoverOpen = false;
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

  showPopover(e: Event) {
    this.popover.event = null
    this.popover.event = e;
    this.isPopoverOpen = false;
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
        message: 'O patch foi aplicado com sucesso. O jogo será reiniciado.',
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

  clearCustomPatch() {
    
  }

  async onPatchFileSelected(e: any) {
    const file: File = e.target.files[0]
    this.isPopoverOpen = false;
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
        header: 'Patch carregado',
        message: `${numberOfFiles} equipes serão carregadas. Tem certeza que deseja aplicar o patch?`,
        backdropDismiss: false,
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
      await this.showErrorAlert(e)
    }
  }

  async showErrorAlert(errorMsg: Error) {
    const alert = await this.alertController.create({
      header: 'Erro',
      message: errorMsg.message,
      backdropDismiss: false,
      buttons: ['OK']
    });
    await alert.present();
  }
  

}
