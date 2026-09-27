import { Component, ChangeDetectionStrategy } from '@angular/core';
import { rovingRadioKeydown } from '../../../core/ui/roving-radio';
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
  styleUrls: ['../settings-section.scss', './appearance-section.component.scss'],
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
    rovingRadioKeydown(
      event, index, this.options.length,
      (i) => this.select(this.options[i].value),
      (i) => this.optionId(this.options[i]),
    );
  }
}
