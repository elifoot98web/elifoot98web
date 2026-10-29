import { NgModule } from '@angular/core';
import { CanDeactivateFn, Routes, RouterModule } from '@angular/router';

import { GamePage } from './game.page';

/**
 * Back, the Android Back button and an iOS edge swipe leave the game without going through "Voltar
 * ao menu", and used to leave a live emulator and everything since the last save behind. The page
 * answers with that menu's own dialog (see NavigationGuardHelper). Only this route has the guard:
 * the landing page and the spectator's page have nothing to lose, and a spectator leaves through
 * `JoinGamePage.reloadSpectator`.
 */
const confirmLeave: CanDeactivateFn<GamePage> = (page, _route, state, next) => page.canLeave(state.url, next.url);

const routes: Routes = [
  {
    path: '',
    component: GamePage,
    canDeactivate: [confirmLeave]
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class GamePageRoutingModule {}
