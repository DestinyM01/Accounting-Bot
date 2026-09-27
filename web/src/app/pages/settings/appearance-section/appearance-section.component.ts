import { Component, ChangeDetectionStrategy } from '@angular/core';
import { ThemeMode, ThemeService } from '../../../core/ui/theme.service';

interface ThemeOption {
  value: ThemeMode;
  label: string;
}

/** Settings › Appearance: System, Dark or Light, applied instantly and kept on this device. */
@Component({
  selector: 'app-appearance-section',
  imports: [],
  templateUrl: './appearance-section.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./appearance-section.component.scss', '../settings-section.scss'],
})
export class AppearanceSectionComponent {
  readonly options: ThemeOption[] = [
    { value: 'system', label: 'System' },
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
  ];

  constructor(private readonly theme: ThemeService) {}

  get mode(): ThemeMode {
    return this.theme.mode;
  }

  optionId(option: ThemeOption): string {
    return `appearance-opt-${option.value}`;
  }

  /** Roving tabindex: only the selected option sits in the tab order. */
  tabIndexFor(option: ThemeOption): number {
    return option.value === this.mode ? 0 : -1;
  }

  select(mode: ThemeMode): void {
    this.theme.setMode(mode);
  }

  onKeydown(event: KeyboardEvent, index: number): void {
    const { key } = event;
    if (key === ' ' || key === 'Enter') {
      event.preventDefault();
      this.select(this.options[index].value);
      return;
    }
    let next: number;
    if (key === 'ArrowRight' || key === 'ArrowDown') {
      next = (index + 1) % this.options.length;
    } else if (key === 'ArrowLeft' || key === 'ArrowUp') {
      next = (index - 1 + this.options.length) % this.options.length;
    } else {
      return;
    }
    event.preventDefault();
    this.select(this.options[next].value);
    this.focusOption(next);
  }

  /** The newly-active option becomes the roving tabindex target; give it focus to match. */
  private focusOption(index: number): void {
    setTimeout(() => {
      document.getElementById(this.optionId(this.options[index]))?.focus();
    });
  }
}
