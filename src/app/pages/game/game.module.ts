import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular/lazy';
import { GamePageRoutingModule } from './game-routing.module';
import { GamePage } from './game.page';
import { UserGuideComponent } from './components/user-guide/user-guide.component';
import { FaqComponent } from './components/faq/faq.component';
import { ManualComponent } from './components/manual/manual.component';
import { AboutComponent } from './components/about/about.component';
import { OmaticModalComponent } from './components/omatic-modal/omatic-modal.component';
import { DiagnosticsModalComponent } from './components/diagnostics-modal/diagnostics-modal.component';
import { SaveStatusChipComponent } from './components/save-status-chip/save-status-chip.component';
import { SoundChipComponent } from './components/sound-chip/sound-chip.component';
import { OptionsMenuComponent } from './components/options-menu/options-menu.component';
import { AdvancedModalComponent } from './components/advanced-modal/advanced-modal.component';
import { FirstRunCoachComponent } from './components/first-run-coach/first-run-coach.component';
import { BootScreenComponent } from './components/boot-screen/boot-screen.component';
import { CoreComponentsModule } from 'src/app/core/components/core-components.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    CoreComponentsModule,
    GamePageRoutingModule
  ],
  declarations: [
    GamePage,
    UserGuideComponent,
    FaqComponent,
    ManualComponent,
    AboutComponent,
    OmaticModalComponent,
    DiagnosticsModalComponent,
    SaveStatusChipComponent,
    SoundChipComponent,
    OptionsMenuComponent,
    AdvancedModalComponent,
    FirstRunCoachComponent,
    BootScreenComponent
  ]
})
export class GamePageModule {}
