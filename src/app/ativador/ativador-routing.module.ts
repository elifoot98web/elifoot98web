import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { AtivadorPage } from './ativador.page';

const routes: Routes = [
  {
    path: '',
    component: AtivadorPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class AtivadorPageRoutingModule {}
