import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular/lazy';
import { ChatComponent } from './chat/chat/chat.component';
import { MsnEmoticonPipe } from './chat/msn-emoticon.pipe';
import { FormsModule } from '@angular/forms';
import { ParticipantListComponent } from './multiplayer/participant-list/participant-list.component';
import { MultiplayerPanelComponent } from './multiplayer/multiplayer-panel/multiplayer-panel.component';
import { RoomStatusPillComponent } from './multiplayer/room-status-pill/room-status-pill.component';
import { RoomSetupModalComponent } from './multiplayer/room-setup-modal/room-setup-modal.component';
import { DockComponent } from './dock/dock.component';
import { DeckKeyDirective } from './dock/deck-key.directive';

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
    RoomStatusPillComponent,
    DockComponent,
    DeckKeyDirective
  ],
  exports: [
    ChatComponent,
    // Shared by the chat's contact strip and the multiplayer panel.
    ParticipantListComponent,
    MultiplayerPanelComponent,
    RoomSetupModalComponent,
    RoomStatusPillComponent,
    // The control deck: the page mounts it beside the game, as a sibling of #game-container, and
    // gives its own launcher buttons the keycap behaviour (no focus taken, one release).
    DockComponent,
    DeckKeyDirective
  ],
})
export class CoreComponentsModule { }
