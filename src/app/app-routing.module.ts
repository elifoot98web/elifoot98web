import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';

const routes: Routes = [
  {
    path: 'main',
    loadChildren: () => import('./main/main.module').then( m => m.MainPageModule)
  },
  {
    path: 'game',
    loadChildren: () => import('./game/game.module').then( m => m.GamePageModule)
  },
  {
    path: 'ativador',
    loadChildren: () => import('./ativador/ativador.module').then( m => m.AtivadorPageModule)
  },
  {
    path: 'game-doswasmx',
    loadChildren: () => import('./game-doswasmx/game-doswasmx.module').then( m => m.GameDoswasmxPageModule)
  },
  {
    path: '',
    redirectTo: 'game-doswasmx',
    pathMatch: 'full'
  },
];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })
  ],
  exports: [RouterModule]
})
export class AppRoutingModule { }
