import { Component } from '@angular/core';
import { ModalController } from '@ionic/angular';

/**
 * Window chrome only. The roster lives in `app-participant-list`, which the chat's contact
 * strip renders too — a modal is one of two places this listing appears, not its owner.
 */
@Component({
  selector: 'app-participants-modal',
  templateUrl: './participants-modal.component.html',
  styleUrls: ['./participants-modal.component.scss'],
  standalone: false
})
export class ParticipantsModalComponent {
  constructor(private modalController: ModalController) { }

  async close() {
    await this.modalController.dismiss();
  }
}
