import { provideBrowserGlobalErrorListeners } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { MarkdownStudioComponent } from '../app/tools/markdown-studio/markdown-studio.component';

bootstrapApplication(MarkdownStudioComponent, {
  providers: [provideBrowserGlobalErrorListeners()],
}).catch((err) => console.error(err));
