import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';

const routes: Routes = [
  {
    path: 'main',
    loadChildren: () => import('./pages/main/main.module').then( m => m.MainPageModule)
  },
  {
    path: 'game',
    loadChildren: () => import('./pages/game/game.module').then( m => m.GamePageModule)
  },
  {
    path: 'join-game',
    loadChildren: () => import('./pages/join-game/join-game.module').then( m => m.JoinGamePageModule)
  },
  {
    path: '',
    redirectTo: 'main',
    pathMatch: 'full'
  },
];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, {
      preloadingStrategy: PreloadAllModules,
      useHash: true,
      // What the router does to the address bar when a guard refuses a Back. The default
      // ('replace') rewrites the entry the browser already moved to, which loses a level of
      // history: the first Back asks "Voltar ao menu?" and, after Cancelar, the second one leaves
      // the page with no question at all. 'computed' walks the history pointer back to where the
      // page is instead (a `history.go` that fires a popstate for the page's own URL, which the
      // router ignores), so every Back asks, and nothing loops. Only the game page has a guard
      // (see NavigationGuardHelper); no other navigation is ever refused.
      canceledNavigationResolution: 'computed',
    })
  ],
  exports: [RouterModule]
})
export class AppRoutingModule { }
