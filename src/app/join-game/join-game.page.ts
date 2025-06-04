import { Component, OnInit } from '@angular/core';
import { AlertController, LoadingController } from '@ionic/angular';
import { MultiplayerGuestService } from '../services/multiplayer-guest.service';

@Component({
  selector: 'app-join-game',
  templateUrl: './join-game.page.html',
  styleUrls: ['./join-game.page.scss'],
  standalone: false,
})
export class JoinGamePage implements OnInit {
  private playerName = '';
  private roomId = '';
  private password = '';
  public joining = false;
  public joinError = '';
  public hostStream?: MediaStream;

  constructor(
    private loadingController: LoadingController, 
    private alertController: AlertController,
    private multiplayerGuestService: MultiplayerGuestService
  ) { }

  async ngOnInit() {
    await this.promptJoinInfo();
  }

  /**
   * Prompt user for name, room id, and password, then join the game room.
   */
  async promptJoinInfo() {
    const alert = await this.alertController.create({
      header: 'Entrar na Sala',
      inputs: [
        { name: 'playerName', type: 'text', placeholder: 'Seu nome', value: this.playerName },
        { name: 'roomId', type: 'text', placeholder: 'ID da sala', value: this.roomId },
        { name: 'password', type: 'password', placeholder: 'Senha da Sala', value: this.password },
      ],
      buttons: [
        {
          text: 'Cancelar',
          role: 'cancel',
        },
        {
          text: 'Entrar',
          handler: async (data) => {
            this.playerName = data.playerName;
            this.roomId = data.roomId;
            this.password = data.password;
            await this.joinRoom();
          }
        }
      ]
    });
    await alert.present();
  }

  /**
   * Join the multiplayer room and handle loading/errors.
   */
  async joinRoom() {
    this.joining = true;
    this.joinError = '';
    const loading = await this.loadingController.create({ message: 'Entrando na sala...' });
    await loading.present();
    try {
      await this.multiplayerGuestService.joinGameRoom(this.playerName, this.roomId, this.password);
      this.hostStream = this.multiplayerGuestService.getHostStream();
      // Optionally, subscribe to player list or other events here
    } catch (err: any) {
      this.joinError = err.message || 'Erro ao entrar na sala.';
      await this.showError(this.joinError);
      await this.promptJoinInfo();
    } finally {
      this.joining = false;
      await loading.dismiss();
    }
  }

  /**
   * Show an error alert.
   */
  async showError(message: string) {
    const alert = await this.alertController.create({
      header: 'Erro',
      message,
      buttons: ['OK']
    });
    await alert.present();
  }

  /**
   * Handle pointer (mouse/touch) move and send to peers.
   */
  onPointerMove(event: MouseEvent | TouchEvent) {
    let x = 0, y = 0;
    if (event instanceof MouseEvent) {
      x = event.offsetX;
      y = event.offsetY;
    } else if (event instanceof TouchEvent && event.touches.length > 0) {
      const rect = (event.target as HTMLElement).getBoundingClientRect();
      x = event.touches[0].clientX - rect.left;
      y = event.touches[0].clientY - rect.top;
    }
    this.multiplayerGuestService.sendPlayerPointer({ x, y, color: '#00f' });
  }
}
