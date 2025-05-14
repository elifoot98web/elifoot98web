import { Component, OnInit } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { LayoutHelperService } from 'src/app/services/layout-helper.service';

@Component({
  selector: 'app-omatic-modal',
  templateUrl: './omatic-modal.component.html',
  styleUrls: ['./omatic-modal.component.scss'],
  standalone: false,
})
export class OmaticModalComponent implements OnInit {

  constructor(private modalController:ModalController, private layoutHelperService: LayoutHelperService) { }

  ngOnInit() {}
  
  get isMobile(): boolean {
    return this.layoutHelperService.isMobile
  }

  close(){
    this.modalController.dismiss();
  }
}
