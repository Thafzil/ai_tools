import { Component, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { LucideBoxes, LucideHome, LucideMoon, LucideSun } from '@lucide/angular';
import { ThemeService } from './shell/theme.service';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterOutlet, LucideBoxes, LucideHome, LucideMoon, LucideSun],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly themeService = inject(ThemeService);

  protected readonly isDark = this.themeService.isDark;
  protected readonly theme = this.themeService.theme;

  protected toggleTheme(): void {
    this.themeService.toggleTheme();
  }
}
