import type { Type } from '@angular/core';
import { routes } from './app.routes';
import { HomeComponent } from './shell/home/home.component';

async function loadRouteComponent(path: string): Promise<Type<unknown>> {
  const route = routes.find((candidate) => candidate.path === path);

  if (!route?.loadComponent) {
    throw new Error(`Route ${path} does not lazy-load a component`);
  }

  return route.loadComponent() as Promise<Type<unknown>>;
}

describe('app routes', () => {
  it('should lazy load the shell home page', async () => {
    await expect(loadRouteComponent('')).resolves.toBe(HomeComponent);
  });

  it('should use a workspace title for the home route', () => {
    const homeRoute = routes.find((route) => route.path === '');

    expect(homeRoute?.title).toBe('Workspace Tools');
  });

  it('should register Markdown AST Studio as a federated tool route', () => {
    const toolRoute = routes.find((candidate) => candidate.path === 'tools/markdown-ast-studio');

    expect(toolRoute?.loadChildren).toBeTruthy();
    expect(toolRoute?.title).toBe('Markdown AST Studio');
  });
});
