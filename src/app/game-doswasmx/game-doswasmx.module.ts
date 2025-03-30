import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { GameDoswasmxPageRoutingModule } from './game-doswasmx-routing.module';

import { GameDoswasmxPage } from './game-doswasmx.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    GameDoswasmxPageRoutingModule
  ],
  declarations: [GameDoswasmxPage]
})
export class GameDoswasmxPageModule {}
