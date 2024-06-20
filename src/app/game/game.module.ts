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
import { RecaptchaModule } from 'ng-recaptcha';
import { MultiplayerService } from '../services/multiplayer.service';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    GamePageRoutingModule,
    RecaptchaModule,
  ],
  declarations: [GamePage],
  providers: [
    SaveGameService, 
    LocalStorageService, 
    PatchService, 
    AuthenticationService, 
    MultiplayerService
  ]
})
export class GamePageModule {}
