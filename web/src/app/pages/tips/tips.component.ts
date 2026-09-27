import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';

import { TitleCasePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from '../../core/services/api.service';
import { CategoryService } from '../../core/services/category.service';
import { Tip } from '../../core/services/api.models';
import { IconComponent } from '../../core/ui/icon/icon.component';
import { tablerIcon } from '../../core/ui/icon/icons';

@Component({
    selector: 'app-tips',
    imports: [IconComponent, TitleCasePipe],
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
  /** The load/refresh failure was a 503 (the api's AI provider is unavailable) — shown as an empty state, not an inline error. */
  serviceUnavailable = false;

  constructor(private api: ApiService, private catSvc: CategoryService) {}

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading = true;
    this.error = '';
    this.serviceUnavailable = false;
    this.api.getTips().subscribe({
      next: (tips) => { this.tips = tips; this.loading = false; },
      error: (e: HttpErrorResponse) => this.onError(e, 'Failed to load tips. Please try again.'),
    });
  }

  refresh() {
    this.refreshing = true;
    this.error = '';
    this.serviceUnavailable = false;
    this.api.refreshTips().subscribe({
      next: (tips) => { this.tips = tips; this.refreshing = false; },
      error: (e: HttpErrorResponse) => this.onError(e, 'Refresh failed. Please try again.'),
    });
  }

  priorityLabel(p: Tip['priority']): string {
    return { high: 'High impact', medium: 'Medium impact', low: 'Low impact' }[p];
  }

  catColor(category: string): string {
    return this.catSvc.color(category);
  }

  trackByTitle(_: number, t: Tip) { return t.title; }

  private onError(e: HttpErrorResponse, fallback: string) {
    this.serviceUnavailable = e.status === 503;
    this.error = typeof e?.error?.message === 'string' ? e.error.message : fallback;
    this.loading = false;
    this.refreshing = false;
  }
}
