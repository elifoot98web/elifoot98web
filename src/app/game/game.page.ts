import { Component, OnInit, ViewChild } from '@angular/core';
import { AlertController, IonModal, LoadingController } from '@ionic/angular';
import { SaveGameService } from '../services/save-game.service';
import { LocalStorageService } from '../services/local-storage.service';
import { PatchService } from '../services/patch.service';
import * as JSZip from 'jszip';
import { GameHostingInfo } from '../models/hostInfo';
import { AuthenticationService } from '../services/authentication.service';
import { environment } from 'src/environments/environment';
import { MultiplayerService } from '../services/multiplayer.service';

@Component({
  selector: 'app-game',
  templateUrl: './game.page.html',
  styleUrls: ['./game.page.scss'],
})
export class GamePage implements OnInit {
  recaptchaKey = environment.recaptchaSiteKey

  @ViewChild('optionsPopover') optionsPopover: any;
  @ViewChild('hostGameModal') modal!: IonModal;
  @ViewChild('stream-container') videoContainer!: HTMLVideoElement;
  
  smoothFilterActive = false;
  isOptionsMenuOpen = false;
  isHostGameModalOpen = false;
  isHidden = true;
  dosCI: any = null;
  autoSaveInterval: any = null;

  gameHostingInfo: GameHostingInfo = {
    playerId: '',
    playerName: 'Player 1',
    roomId: '',
    gameState: 'NOT_CREATED'
  }

  private recaptchaToken = ''

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
    this.hideOptionsPopover()
  }

  async downloadGameSaves() {
    const hasSaved = await this.saveGameService.downloadGameSaves(this.dosCI)
    this.hideOptionsPopover()
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
    this.hideOptionsPopover()
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

  showOptionsPopover(e: Event) {
    this.optionsPopover.event = null
    this.optionsPopover.event = e;
    this.hideOptionsPopover()
    setTimeout(() => {
      this.isOptionsMenuOpen = true;
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
    this.hideOptionsPopover()
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
        message: `${numberOfFiles} arquivos do patch serão carregados, podendo incluir, além de equipes, bandeiras e arquivos de configuração\n Continuar?`,
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
    this.hideOptionsPopover()
    this.isHostGameModalOpen = true
  }

  onDismissHostGameModal(_: any) {
    this.isHostGameModalOpen = false
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
      
      this.gameHostingInfo.playerId = userId
      
      const canvas = document.getElementsByClassName('emulator-canvas')[0] as HTMLCanvasElement
      const canvasStream = canvas.captureStream(30)
      const roomId = await this.multiplayerService.createRoom(this.gameHostingInfo, canvasStream, (connectionState) => {
        this.onConnectionStateChange(connectionState)
      })
      this.gameHostingInfo.roomId = roomId
      this.gameHostingInfo.gameState = 'AWAITING_REMOTE_PLAYER'
      await loading.dismiss()
    } catch (e: any) {
      console.error(e)
      await loading.dismiss()
      await this.showErrorAlert(e)
    }

  }

  get isHostGameFormValid(): boolean {
    return this.gameHostingInfo.playerName.length > 0 && this.recaptchaToken.length > 0
  }

  captchaSolved(token: string) {
    this.recaptchaToken = token || "" 
  }

  copyToClipboard(text: string) {
    navigator.clipboard.writeText(text)
  }

  private hideOptionsPopover() {
    this.isOptionsMenuOpen = false;
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
    this.hideOptionsPopover()
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

  private onConnectionStateChange(state: RTCPeerConnectionState) {
    if(state === 'connected') {
      this.gameHostingInfo.gameState = 'PLAYER_CONNECTED'
    }
  }
}
