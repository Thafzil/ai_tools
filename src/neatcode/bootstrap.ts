import { provideHttpClient } from '@angular/common/http';
import { provideBrowserGlobalErrorListeners } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { NeatCodeAcademyComponent } from '../app/tools/neatcode-academy/neatcode-academy.component';

bootstrapApplication(NeatCodeAcademyComponent, {
  providers: [provideBrowserGlobalErrorListeners(), provideHttpClient()],
}).catch((err) => console.error(err));
