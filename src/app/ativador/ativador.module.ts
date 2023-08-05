import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { AtivadorPageRoutingModule } from './ativador-routing.module';

import { AtivadorPage } from './ativador.page';
import { MaskitoModule } from '@maskito/angular';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    AtivadorPageRoutingModule,
    MaskitoModule
  ],
  declarations: [AtivadorPage]
})
export class AtivadorPageModule {}
