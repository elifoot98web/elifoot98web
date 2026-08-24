import { Injectable } from '@angular/core';
import { AlertController, ModalController, ToastController } from '@ionic/angular';
import { ParticipantsModalComponent } from '../../components/multiplayer/participants-modal/participants-modal.component';
import { RoomSetupModalComponent, RoomSetupResult } from '../../components/multiplayer/room-setup-modal/room-setup-modal.component';
import { RoomCodeHelper } from '../../helpers/room-code.helper';

/**
 * Shared multiplayer dialogs. Host and guest pages need the same room-setup form,
 * participants roster, leave confirmation and share affordances, so they live here
 * rather than being duplicated in both pages.
 */
@Injectable({
  providedIn: 'root'
})
export class MultiplayerUiService {
  constructor(
    private modalController: ModalController,
    private alertController: AlertController,
    private toastController: ToastController
  ) { }

  /**
   * @returns the collected room details, or null if the user cancelled.
   */
  async promptRoomSetup(mode: 'host' | 'guest', presetRoomCode = ''): Promise<RoomSetupResult | null> {
    const modal = await this.modalController.create({
      component: RoomSetupModalComponent,
      componentProps: { mode, presetRoomCode },
      cssClass: 'win9x-modal multiplayer-room-setup-modal',
    });
    await modal.present();

    const { data, role } = await modal.onWillDismiss<RoomSetupResult>();
    return role === 'confirm' && data ? data : null;
  }

  async showParticipants(): Promise<void> {
    const modal = await this.modalController.create({
      component: ParticipantsModalComponent,
      cssClass: 'win9x-modal',
    });
    await modal.present();
  }

  async confirmLeave(message: string): Promise<boolean> {
    const alert = await this.alertController.create({
      header: 'Sair da sala?',
      message,
      buttons: [
        { text: 'Ficar', role: 'cancel' },
        { text: 'Sair', role: 'confirm', cssClass: 'alert-danger' },
      ],
    });
    await alert.present();

    // Backdrop dismissal reports neither role, which correctly reads as "don't leave".
    const { role } = await alert.onDidDismiss();
    return role === 'confirm';
  }

  async showError(message: string, header = 'Erro'): Promise<void> {
    const alert = await this.alertController.create({ header, message, buttons: ['OK'] });
    await alert.present();
    await alert.onDidDismiss();
  }

  /**
   * Share the join link via the native share sheet where available, falling back to
   * copying it to the clipboard.
   */
  async shareRoom(roomCode: string): Promise<void> {
    const link = RoomCodeHelper.buildJoinLink(roomCode);
    const shareData = {
      title: 'Elifoot 98 Online',
      text: `Entre na minha sala do Elifoot 98: ${roomCode}`,
      url: link,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch (err: any) {
        // AbortError just means the user dismissed the sheet; anything else falls back to copying.
        if (err?.name === 'AbortError') return;
        console.warn('Native share failed, falling back to clipboard', err);
      }
    }

    await this.copyToClipboard(link, 'Link da sala copiado!');
  }

  async copyToClipboard(text: string, successMessage: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      await this.showToast(successMessage);
    } catch (err) {
      console.warn('Clipboard write failed', err);
      await this.showError(`Não foi possível copiar automaticamente. Copie manualmente:\n\n${text}`);
    }
  }

  async showToast(message: string, color = 'success'): Promise<void> {
    const toast = await this.toastController.create({
      message,
      duration: 2000,
      position: 'bottom',
      color,
    });
    await toast.present();
  }
}
