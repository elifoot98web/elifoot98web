import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { JoinGamePage } from './join-game.page';

const routes: Routes = [
  {
    path: '',
    component: JoinGamePage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class JoinGamePageRoutingModule {}
