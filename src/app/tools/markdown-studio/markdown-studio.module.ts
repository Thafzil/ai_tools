import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { MarkdownStudioComponent } from './markdown-studio.component';

const routes: Routes = [
  {
    path: '',
    component: MarkdownStudioComponent,
  },
];

@NgModule({
  imports: [MarkdownStudioComponent, RouterModule.forChild(routes)],
})
export class MarkdownStudioModule {}
