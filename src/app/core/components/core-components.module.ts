import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { ChatComponent } from './chat/chat/chat.component';
import { MsnEmoticonPipe } from './chat/msn-emoticon.pipe';
import { FormsModule } from '@angular/forms';
import { ParticipantListComponent } from './multiplayer/participant-list/participant-list.component';
import { MultiplayerPanelComponent } from './multiplayer/multiplayer-panel/multiplayer-panel.component';
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
    MultiplayerPanelComponent,
    RoomSetupModalComponent,
    RoomStatusPillComponent
  ],
  exports: [
    ChatComponent,
    // Shared by the chat's contact strip and the multiplayer panel.
    ParticipantListComponent,
    MultiplayerPanelComponent,
    RoomSetupModalComponent,
    RoomStatusPillComponent
  ],
})
export class CoreComponentsModule { }
