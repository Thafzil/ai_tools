import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { NeatCodeAcademyComponent } from './neatcode-academy.component';

const routes: Routes = [
  {
    path: '',
    component: NeatCodeAcademyComponent,
  },
];

@NgModule({
  imports: [NeatCodeAcademyComponent, RouterModule.forChild(routes)],
})
export class NeatCodeAcademyModule {}
