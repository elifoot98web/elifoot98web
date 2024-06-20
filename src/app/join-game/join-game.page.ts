import { Component, OnInit, ViewChild } from '@angular/core';
import { MultiplayerService } from '../services/multiplayer.service';
import { environment } from 'src/environments/environment';
import { AlertController, LoadingController } from '@ionic/angular';
import { AuthenticationService } from '../services/authentication.service';

@Component({
  selector: 'app-join-game',
  templateUrl: './join-game.page.html',
  styleUrls: ['./join-game.page.scss'],
})
export class JoinGamePage {
  roomId = ''
  roomConnected = false
  recaptchaKey = environment.recaptchaSiteKey
  recaptchaToken = ''
  
  constructor(private multiplayerService: MultiplayerService, 
    private loadingController: LoadingController,
    private alertController: AlertController, 
    private authService: AuthenticationService) { }

  get canJoin() {
    return this.roomId.length >= 6 && this.recaptchaToken.length > 0
  }

  async joinGame() {
    const loading = await this.loadingController.create({
      message: 'Validando navegador...',
      backdropDismiss: false
    })
    await loading.present()
    
    try {
      // Validate recaptcha
      const recaptchaValid = await this.authService.validateRecaptcha(this.recaptchaToken)
      if (!recaptchaValid) {
        throw new Error('Recaptcha inválido, tente novamente.')
      }

      // Joining room
      loading.message = 'Tentando conectar-se ao host...'
      const video = document.querySelector('#stream-container') as HTMLVideoElement
      if(!video) throw new Error('Video element not found')
      
      const stream = await this.multiplayerService.joinRoom(this.roomId)
      console.log('Remote Stream:', { stream })
      video.srcObject = stream
      this.roomConnected = true
      await loading.dismiss()
    } catch (error: any) {
      await loading.dismiss()
      await this.showErrorAlert(error)
    }
  }

  captchaSolved(token: string) {
    this.recaptchaToken = token || "" 
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
}
