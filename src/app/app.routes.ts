import { Routes } from '@angular/router';
import { loadRemoteModule } from '@angular-architects/native-federation';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./shell/home/home.component').then((m) => m.HomeComponent),
    title: 'Workspace Tools',
  },
  {
    path: 'tools/markdown-ast-studio',
    loadChildren: () =>
      loadRemoteModule('markdownAstStudio', './MarkdownStudioModule').then(
        (m) => m.MarkdownStudioModule,
      ),
    title: 'Markdown AST Studio',
  },
  {
    path: 'markdown-ast-studio',
    pathMatch: 'full',
    redirectTo: 'tools/markdown-ast-studio',
  },
  {
    path: '**',
    redirectTo: '',
  },
];
