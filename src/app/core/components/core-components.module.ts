import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { ChatComponent } from './chat/chat/chat.component';
import { MsnEmoticonPipe } from './chat/msn-emoticon.pipe';
import { FormsModule } from '@angular/forms';
import { ParticipantsModalComponent } from './multiplayer/participants-modal/participants-modal.component';
import { ParticipantListComponent } from './multiplayer/participant-list/participant-list.component';
import { RoomStatusPillComponent } from './multiplayer/room-status-pill/room-status-pill.component';
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
    ParticipantListComponent,
    ParticipantsModalComponent,
    RoomSetupModalComponent,
    RoomStatusPillComponent
  ],
  exports: [
    ChatComponent,
    // Exported as well as declared: the chat consumes it in-module, but the Phase 5
    // multiplayer panel is meant to absorb the participants modal and will need it.
    ParticipantListComponent,
    ParticipantsModalComponent,
    RoomSetupModalComponent,
    RoomStatusPillComponent
  ],
})
export class CoreComponentsModule { }
