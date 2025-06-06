import { Component } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { LayoutHelperService } from 'src/app/core/services/shared';

@Component({
  selector: 'app-about',
  templateUrl: './about.component.html',
  styleUrls: ['./about.component.scss'],
  standalone: false
})
export class AboutComponent {

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
