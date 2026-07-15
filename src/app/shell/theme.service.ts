import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark';

const THEME_CHANGE_EVENT = 'workspace-theme-change';
const THEME_STORAGE_KEY = 'workspace-tools.theme';
const LEGACY_THEME_STORAGE_KEY = 'decoders.markdown.theme';

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark';
}

function readStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    const legacyStored = localStorage.getItem(LEGACY_THEME_STORAGE_KEY);

    if (isThemeMode(stored)) {
      return stored;
    }

    if (isThemeMode(legacyStored)) {
      return legacyStored;
    }

    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly themeSignal = signal<ThemeMode>(readStoredTheme());

  readonly isDark = computed(() => this.theme() === 'dark');
  readonly theme = this.themeSignal.asReadonly();

  constructor() {
    this.applyTheme(this.theme());

    const handleThemeChange = (event: Event): void => {
      const nextTheme = (event as CustomEvent<{ theme?: ThemeMode }>).detail?.theme;

      if (!isThemeMode(nextTheme) || nextTheme === this.theme()) {
        return;
      }

      this.themeSignal.set(nextTheme);
      this.applyTheme(nextTheme);
    };

    const handleStorage = (event: StorageEvent): void => {
      if (event.key !== THEME_STORAGE_KEY || !isThemeMode(event.newValue)) {
        return;
      }

      this.themeSignal.set(event.newValue);
      this.applyTheme(event.newValue);
    };

    window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange);
    window.addEventListener('storage', handleStorage);

    this.destroyRef.onDestroy(() => {
      window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange);
      window.removeEventListener('storage', handleStorage);
    });
  }

  toggleTheme(): void {
    this.setTheme(this.isDark() ? 'light' : 'dark');
  }

  setTheme(theme: ThemeMode): void {
    this.themeSignal.set(theme);
    this.persistTheme(theme);
    this.applyTheme(theme);
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { theme } }));
  }

  private applyTheme(theme: ThemeMode): void {
    document.documentElement.dataset['theme'] = theme;
    document.documentElement.style.colorScheme = theme;
  }

  private persistTheme(theme: ThemeMode): void {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
      localStorage.setItem(LEGACY_THEME_STORAGE_KEY, theme);
    } catch {
      // Theme preference is non-critical when storage is unavailable.
    }
  }
}
