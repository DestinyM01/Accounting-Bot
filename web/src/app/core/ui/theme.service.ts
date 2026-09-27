import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';

export type ThemeMode = 'system' | 'dark' | 'light';
export type EffectiveTheme = 'dark' | 'light';

const STORAGE_KEY = 'accbot.theme';

/** The stored mode, or 'system' when nothing valid is stored (private browsing, disabled storage, first visit). */
function readStoredMode(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'dark' || v === 'light' || v === 'system') return v;
  } catch {
    // Storage can throw (private mode, blocked cookies): fall back silently.
  }
  return 'system';
}

/**
 * The app's theme: System, Dark or Light, chosen in Settings -> Appearance and kept in
 * localStorage on this device. Applying a mode sets (or clears) `<html data-theme>`, which
 * tokens.css keys off of. `changes` lets chart pages rebuild with the new colors without a
 * reload, and fires both for an explicit choice and, while following the system, for a live
 * `prefers-color-scheme` change (e.g. the OS switching to dark at night).
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private currentMode: ThemeMode = readStoredMode();
  private readonly systemQuery = matchMedia('(prefers-color-scheme: light)');
  private readonly changes$ = new Subject<EffectiveTheme>();

  readonly changes: Observable<EffectiveTheme> = this.changes$.asObservable();

  constructor() {
    this.apply(this.currentMode);
    this.systemQuery.addEventListener('change', () => {
      if (this.currentMode === 'system') this.changes$.next(this.effective());
    });
  }

  get mode(): ThemeMode {
    return this.currentMode;
  }

  /** Stores the choice, applies it to the document, and notifies subscribers. */
  setMode(mode: ThemeMode): void {
    this.currentMode = mode;
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Nothing to do: the mode still applies for this page load, it just won't survive a reload.
    }
    this.apply(mode);
    this.changes$.next(this.effective());
  }

  /** The theme actually in effect: 'system' resolves through the OS preference. */
  effective(): EffectiveTheme {
    if (this.currentMode === 'dark' || this.currentMode === 'light') return this.currentMode;
    return this.systemQuery.matches ? 'light' : 'dark';
  }

  private apply(mode: ThemeMode): void {
    if (mode === 'system') {
      delete document.documentElement.dataset['theme'];
    } else {
      document.documentElement.dataset['theme'] = mode;
    }
  }
}
