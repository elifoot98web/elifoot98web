import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { JoinGamePageRoutingModule } from './join-game-routing.module';

import { JoinGamePage } from './join-game.page';
import { MultiplayerGuestService } from '../services/multiplayer-guest.service';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    JoinGamePageRoutingModule
  ],
  declarations: [JoinGamePage],
  providers: [MultiplayerGuestService]
})
export class JoinGamePageModule {}
