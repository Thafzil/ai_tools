import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideArrowRight, LucideBraces, LucideBrain } from '@lucide/angular';
import { TOOL_CATALOG } from '../../tools/tool-catalog';

@Component({
  selector: 'app-home',
  imports: [CommonModule, RouterLink, LucideArrowRight, LucideBraces, LucideBrain],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent {
  protected readonly tools = TOOL_CATALOG;
}
