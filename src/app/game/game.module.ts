import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { GamePageRoutingModule } from './game-routing.module';

import { GamePage } from './game.page';
import { SaveGameService } from '../services/save-game.service';
import { LocalStorageService } from '../services/local-storage.service';
import { PatchService } from '../services/patch.service';
import { UserGuideComponent } from './components/user-guide/user-guide.component';
import { FaqComponent } from './components/faq/faq.component';
import { ManualComponent } from './components/manual/manual.component';
import { AboutComponent } from './components/about/about.component';
import { LayoutHelperService } from '../services/layout-helper.service';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    GamePageRoutingModule
  ],
  declarations: [
    GamePage,
    UserGuideComponent,
    FaqComponent,
    ManualComponent,
    AboutComponent
  ],
  providers: [SaveGameService, LocalStorageService, PatchService, LayoutHelperService]
})
export class GamePageModule {}
