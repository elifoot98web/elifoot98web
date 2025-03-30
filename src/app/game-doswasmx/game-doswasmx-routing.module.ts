import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { GameDoswasmxPage } from './game-doswasmx.page';

const routes: Routes = [
  {
    path: '',
    component: GameDoswasmxPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class GameDoswasmxPageRoutingModule {}
