import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { JoinGamePageRoutingModule } from './join-game-routing.module';

import { JoinGamePage } from './join-game.page';
import { MultiplayerService } from '../services/multiplayer.service';
import { RecaptchaModule } from 'ng-recaptcha';
import { AuthenticationService } from '../services/authentication.service';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    JoinGamePageRoutingModule,
    RecaptchaModule
  ],
  declarations: [JoinGamePage],
  providers: [
    MultiplayerService, 
    AuthenticationService
  ]
})
export class JoinGamePageModule {}
