import { Injectable } from '@angular/core';
import { AlertController, ModalController, ToastController } from '@ionic/angular';
import { MultiplayerPanelComponent, MultiplayerPanelAction } from '../../components/multiplayer/multiplayer-panel/multiplayer-panel.component';
import { RoomSetupModalComponent, RoomSetupResult } from '../../components/multiplayer/room-setup-modal/room-setup-modal.component';
import { RoomCodeHelper } from '../../helpers/room-code.helper';

/**
 * Long enough to read the code and reach one of the three buttons, per the study's "≥8 s"
 * note. The pill keeps the code afterwards, so nothing is lost when this expires.
 */
const ROOM_TOAST_DURATION = 9000;

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

  /**
   * The room's own window: code, presence, sharing and the way out, in one place.
   *
   * Replaced `showParticipants()` and the participants modal behind it. Returns the action the
   * user picked rather than acting, because "open the chat" and "leave" mean different things
   * on the host and the guest and neither page's internals belong in this service.
   */
  async showMultiplayerPanel(
    mode: 'host' | 'guest',
    roomCode: string,
    locked: boolean
  ): Promise<MultiplayerPanelAction> {
    const modal = await this.modalController.create({
      component: MultiplayerPanelComponent,
      componentProps: { mode, roomCode, locked },
      cssClass: 'win9x-modal',
    });
    await modal.present();

    const { role } = await modal.onWillDismiss();
    return (role as MultiplayerPanelAction) || 'close';
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

  /**
   * Announce a newly created room without blocking the game behind an alert.
   *
   * Replaces the old "Sala criada!" dialog: the status pill now carries the code
   * permanently, so this only has to be a nudge with the sharing shortcuts on it. Longer
   * than the default toast because it has buttons that have to be reachable, and it is
   * dismissible so it never sits over the pitch.
   */
  async showRoomCreated(roomCode: string): Promise<void> {
    const toast = await this.toastController.create({
      message: `Sala ${roomCode} no ar.`,
      duration: ROOM_TOAST_DURATION,
      position: 'bottom',
      color: 'success',
      buttons: [
        { text: 'Copiar link', handler: () => { void this.copyToClipboard(RoomCodeHelper.buildJoinLink(roomCode), 'Link da sala copiado!'); } },
        { text: 'Compartilhar', handler: () => { void this.shareRoom(roomCode); } },
        { text: 'Fechar', role: 'cancel' },
      ],
    });
    await toast.present();
  }

  async showToast(message: string, color = 'success', duration = 2000): Promise<void> {
    const toast = await this.toastController.create({
      message,
      duration,
      position: 'bottom',
      color,
    });
    await toast.present();
  }
}
