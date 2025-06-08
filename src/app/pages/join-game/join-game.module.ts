import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { JoinGamePageRoutingModule } from './join-game-routing.module';
import { JoinGamePage } from './join-game.page';
import { ChatComponent } from 'src/app/core/components/chat/chat/chat.component';
import { CoreComponentsModule } from 'src/app/core/components/core-components.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    CoreComponentsModule,
    JoinGamePageRoutingModule
  ],
  declarations: [JoinGamePage]
})
export class JoinGamePageModule {}
