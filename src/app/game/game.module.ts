import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { GamePageRoutingModule } from './game-routing.module';

import { GamePage } from './game.page';
import { SaveGameService } from '../services/save-game.service';
import { LocalStorageService } from '../services/local-storage.service';
import { PatchService } from '../services/patch.service';
import { AuthenticationService } from '../services/authentication.service';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    GamePageRoutingModule
  ],
  declarations: [GamePage],
  providers: [SaveGameService, LocalStorageService, PatchService, AuthenticationService]
})
export class GamePageModule {}
