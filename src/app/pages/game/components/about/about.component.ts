import { Component } from '@angular/core';
import { ModalController } from '@ionic/angular/lazy';
import { LayoutHelperService } from 'src/app/core/services/shared';

@Component({
  selector: 'app-about',
  templateUrl: './about.component.html',
  styleUrls: ['./about.component.scss'],
  standalone: false
})
export class AboutComponent {

  /** The year the project started. */
  readonly firstYear = 2023
  /** Read when the modal opens, so the notice never needs a release to stay current. */
  readonly currentYear = new Date().getFullYear()

  constructor(
    private modalController: ModalController, 
    private layoutHelper: LayoutHelperService) { }

  get isMobile() {
    return this.layoutHelper.isMobile
  }

  close() {
    this.modalController.dismiss();
  }

}
