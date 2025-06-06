import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { GamePageRoutingModule } from './game-routing.module';
import { GamePage } from './game.page';
import { UserGuideComponent } from './components/user-guide/user-guide.component';
import { FaqComponent } from './components/faq/faq.component';
import { ManualComponent } from './components/manual/manual.component';
import { AboutComponent } from './components/about/about.component';
import { OmaticModalComponent } from './components/omatic-modal/omatic-modal.component';

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
    AboutComponent,
    OmaticModalComponent
  ]
})
export class GamePageModule {}
