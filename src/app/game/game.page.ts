import { Component, OnInit, ViewChild } from '@angular/core';
import { AlertController, LoadingController } from '@ionic/angular';
import { SaveGameService } from '../services/save-game.service';

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
    private saveGameService: SaveGameService) { }

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
      await this.showTutorial()
    }, 1500);
  }

  async showTutorial() {
    const alert = await this.alertController.create({
      header: 'Avisos',
      message: '- Sempre que terminar de jogar, clique no botão "Salvar Progresso" no topo do site para persistir o jogo salvo neste navegador\n' +
               '- O jogo salvo é persistido no navegador, então se você limpar o cache do navegador, o jogo salvo será perdido\n' +
               '- Caso um erro de "eli.cod" apareça, recarregue a página até que ele suma.\n' +
               '- Pressione ESC para livrar o mouse da janela do jogo.\n' +
               '- Por conta de como o Elifoot 98 verifica a integridade do registro, não é possível salvar o registro no emulador web da aplicação entre sessões diferentes do navegador. É necessário registrar novamente sempre que necessario.\n' +
               '- Ainda não é possível jogar 100% no celular por conta da emulação do mouse e teclado. Estou verificando alternativas.\n',
      backdropDismiss: false,
      cssClass: 'alert-whitespace',
      buttons: [{
        text: 'Entendi',
        handler: () => {
          this.isHidden = false
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
    await this.saveGameService.downloadGameSaves(this.dosCI)
    this.isPopoverOpen = false;
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

}
