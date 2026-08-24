import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { ChatComponent } from './chat/chat/chat.component';
import { MsnEmoticonPipe } from './chat/msn-emoticon.pipe';
import { FormsModule } from '@angular/forms';
import { ParticipantsModalComponent } from './multiplayer/participants-modal/participants-modal.component';
import { RoomSetupModalComponent } from './multiplayer/room-setup-modal/room-setup-modal.component';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule
  ],
  declarations: [
    ChatComponent,
    MsnEmoticonPipe,
    ParticipantsModalComponent,
    RoomSetupModalComponent
  ],
  exports: [
    ChatComponent,
    ParticipantsModalComponent,
    RoomSetupModalComponent
  ],
})
export class CoreComponentsModule { }
