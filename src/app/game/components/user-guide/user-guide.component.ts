import { Component, OnInit } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { LayoutHelperService } from 'src/app/services/layout-helper.service';

@Component({
  selector: 'app-user-guide',
  templateUrl: './user-guide.component.html',
  styleUrls: ['./user-guide.component.scss'],
  standalone: false
})
export class UserGuideComponent {

  constructor(private modalController: ModalController, private layoutHelperService: LayoutHelperService) { }

  get isMobile(): boolean {
    return this.layoutHelperService.isMobile
  }

  close() {
    this.modalController.dismiss();
  }
  
}
