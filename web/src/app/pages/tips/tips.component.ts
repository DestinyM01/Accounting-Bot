import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';

import { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from '../../core/services/api.service';
import { Tip } from '../../core/services/api.models';
import { IconComponent } from '../../core/ui/icon/icon.component';
import { tablerIcon } from '../../core/ui/icon/icons';

@Component({
    selector: 'app-tips',
    imports: [IconComponent],
    templateUrl: './tips.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./tips.component.scss']
})
export class TipsComponent implements OnInit {
  readonly tablerIcon = tablerIcon;

  tips: Tip[] = [];
  loading = false;
  refreshing = false;
  error = '';

  constructor(private api: ApiService) {}

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading = true;
    this.error = '';
    this.api.getTips().subscribe({
      next: (tips) => { this.tips = tips; this.loading = false; },
      error: (e: HttpErrorResponse) => {
        this.error = typeof e?.error?.message === 'string' ? e.error.message : 'Failed to load tips. Please try again.';
        this.loading = false;
      },
    });
  }

  refresh() {
    this.refreshing = true;
    this.error = '';
    this.api.refreshTips().subscribe({
      next: (tips) => { this.tips = tips; this.refreshing = false; },
      error: (e: HttpErrorResponse) => {
        this.error = typeof e?.error?.message === 'string' ? e.error.message : 'Refresh failed. Please try again.';
        this.refreshing = false;
      },
    });
  }

  priorityLabel(p: Tip['priority']): string {
    return { high: 'High Impact', medium: 'Medium Impact', low: 'Low Impact' }[p];
  }

  trackByTitle(_: number, t: Tip) { return t.title; }
}
