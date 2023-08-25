import { Component, OnInit, ViewChild } from '@angular/core';
import { AlertController, IonModal, LoadingController } from '@ionic/angular';
import { SaveGameService } from '../services/save-game.service';
import { LocalStorageService } from '../services/local-storage.service';
import { PatchService } from '../services/patch.service';
import * as JSZip from 'jszip';
import { HostInfo } from '../models/hostInfo';
import { AuthenticationService } from '../services/authentication.service';
import { environment } from 'src/environments/environment';
import { MultiplayerService } from '../services/multiplayer.service';

@Component({
  selector: 'app-game',
  templateUrl: './game.page.html',
  styleUrls: ['./game.page.scss'],
})
export class GamePage implements OnInit {
  @ViewChild('popover') popover: any;
  @ViewChild('hostGameModal') modal!: IonModal;
  @ViewChild('stream-container') videoContainer!: HTMLVideoElement;

  smoothFilterActive = false;
  isPopoverOpen = false;
  isHostGameModalOpen = false;
  isHidden = true;
  dosCI: any = null;
  autoSaveInterval: any = null;
  recaptchaKey = environment.recaptchaSiteKey
  playerName = ''
  private recaptchaToken = ''
  private playerId = ''

  constructor(private loadingController: LoadingController, 
    private alertController: AlertController, 
    private saveGameService: SaveGameService,
    private patchService: PatchService,
    private storageService: LocalStorageService,
    private authService: AuthenticationService,
    private multiplayerService: MultiplayerService) { }

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

  openHostGameModal() {
    this.hidePopover()
    this.isHostGameModalOpen = true
    const canvas = document.getElementsByClassName('emulator-canvas')[0] as HTMLCanvasElement
    console.log("Canvas", {canvas})
    const video = document.querySelector('#stream-container') as HTMLVideoElement
    console.log("Video", {video})
  }

  onDismissHostGameModal(event: any) {
    this.isHostGameModalOpen = false
    console.log("Dismissed", {event})
  }

  modalClose() {
    this.modal.dismiss()
    this.isHostGameModalOpen = false
  }

  async startHost() {
    const loading = await this.loadingController.create({
      message: 'Validando navegador...',
      backdropDismiss: false
    })
    await loading.present()
    
    try {
      // Validate recaptcha token on api server
      const recaptchaValid = await this.authService.validateRecaptcha(this.recaptchaToken)
      if (!recaptchaValid) {
        throw new Error('Recaptcha inválido, tente novamente.')
      }
      // Autenticate user anonymously on firebase
      loading.message = 'Autenticando...'
      const userId = await this.authService.annonymousLogin()

      // Create room on firestore
      loading.message = 'Criando Sala...'
      this.playerId = userId
      const hostInfo: HostInfo = {
        playerId: this.playerId,
        playerName: this.playerName
      }
      const canvas = document.getElementsByClassName('emulator-canvas')[0] as HTMLCanvasElement
      const canvasStream = canvas.captureStream(24)
      const roomId = await this.multiplayerService.createRoom(hostInfo, canvasStream)
      console.log({roomId})
      await loading.dismiss()
    } catch (e: any) {
      console.error(e)
      await loading.dismiss()
      await this.showErrorAlert(e)
    }

  }

  get isHostGameFormValid(): boolean {
    return this.playerName.length > 0 && this.recaptchaToken.length > 0
  }

  captchaResolved(token: string) {
    console.log("captcha resolved", {token})
    this.recaptchaToken = token || "" 
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
}
