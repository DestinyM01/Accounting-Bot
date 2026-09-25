import { Component, OnDestroy, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { SettingsView } from '../../../core/services/api.models';

type ReportsView = SettingsView['reports'];

/** Settings › Email reports: which reports go out, to whom, and a test send. */
@Component({
  selector: 'app-reports-section',
  standalone: true,
  imports: [DatePipe, FormsModule, MatIconModule],
  templateUrl: './reports-section.component.html',
  styleUrls: ['../settings-section.scss'],
})
export class ReportsSectionComponent implements OnInit, OnDestroy {
  view: ReportsView | null = null;
  loading = true;
  loadError = '';
  weekly = true;
  monthly = true;
  recipient = '';
  confirmReset = false;
  saving = false;
  saveError = '';
  saved = '';
  testState: 'idle' | 'sending' | 'sent' | 'error' = 'idle';
  testError = '';

  private gen = 0;
  private destroyed = false;
  private testTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly subs = new Subscription();

  constructor(private readonly api: ApiService) {}

  ngOnInit() {
    this.load();
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.subs.unsubscribe();
    if (this.testTimer) clearTimeout(this.testTimer);
  }

  /** Where reports go when the field is empty: the server's address, when the view knows it. */
  get fallback(): string {
    return this.view?.recipient.source === 'config' ? this.view.recipient.value ?? '' : '';
  }

  get dirty(): boolean {
    const v = this.view;
    if (!v) return false;
    return this.weekly !== v.weekly.value || this.monthly !== v.monthly.value || this.recipient.trim() !== this.savedRecipient;
  }

  /** Whether any of the three fields is currently a saved override, so resetting to config means something. */
  get savedHere(): boolean {
    const v = this.view;
    return !!v && (v.weekly.source === 'saved' || v.monthly.source === 'saved' || v.recipient.source === 'saved');
  }

  get testLabel(): string {
    switch (this.testState) {
      case 'sending': return 'Sending…';
      case 'sent': return 'Sent — check your inbox';
      default: return 'Send a test digest';
    }
  }

  save() {
    if (!this.dirty || this.saving) return;
    this.saving = true;
    this.saveError = '';
    this.saved = '';
    this.subs.add(
      this.api.saveReportSettings({ weekly: this.weekly, monthly: this.monthly, recipient: this.recipient.trim() || null }).subscribe({
        next: (s) => {
          this.saving = false;
          this.apply(s.reports);
          this.saved = 'Saved.';
          this.focus('reports-weekly'); // Save is disabled again, so focus moves to the form
        },
        error: (e: HttpErrorResponse) => {
          this.saving = false;
          this.saveError = this.message(e, "Couldn't save. Please try again.");
          this.focus('reports-recipient');
        },
      }),
    );
  }

  /** First click asks; the second forgets the saved reports section so it follows the server's config again. */
  resetToConfig() {
    if (!this.confirmReset) {
      this.confirmReset = true;
      this.focus('reports-reset-yes');
      return;
    }
    this.confirmReset = false;
    this.saving = true;
    this.saveError = '';
    this.saved = '';
    this.subs.add(
      this.api.resetReportSettings().subscribe({
        next: (s) => {
          this.saving = false;
          this.apply(s.reports);
          this.saved = "Now following the server's config.";
          this.focus('reports-weekly');
        },
        error: (e: HttpErrorResponse) => {
          this.saving = false;
          this.saveError = this.message(e, "Couldn't reset. Please try again.");
          this.focus('reports-recipient');
        },
      }),
    );
  }

  sendTest() {
    if (this.testState === 'sending') return;
    if (this.testTimer) {
      clearTimeout(this.testTimer);
      this.testTimer = null;
    }
    this.testState = 'sending';
    this.testError = '';
    this.subs.add(
      this.api.sendTestDigest().subscribe({
        next: () => {
          this.testState = 'sent';
          this.testTimer = setTimeout(() => {
            this.testState = 'idle';
            this.testTimer = null;
          }, 5000);
          this.focus('reports-test');
        },
        error: (e: HttpErrorResponse) => {
          this.testState = 'error';
          this.testError = e.status === 503 ? "Email isn't configured on the server" : "Couldn't send the test email";
          this.focus('reports-test');
        },
      }),
    );
  }

  private get savedRecipient(): string {
    return this.view?.recipient.source === 'saved' ? this.view.recipient.value ?? '' : '';
  }

  private apply(v: ReportsView) {
    this.view = v;
    this.weekly = v.weekly.value;
    this.monthly = v.monthly.value;
    this.recipient = this.savedRecipient;
  }

  private load() {
    const gen = ++this.gen;
    this.subs.add(
      this.api.getSettings().subscribe({
        next: (s) => {
          if (gen !== this.gen) return;
          this.apply(s.reports);
          this.loading = false;
          this.loadError = '';
        },
        error: () => {
          if (gen !== this.gen) return;
          this.loading = false;
          this.loadError = "Couldn't load the report settings.";
        },
      }),
    );
  }

  private message(e: HttpErrorResponse, fallback: string): string {
    return typeof e.error?.message === 'string' ? e.error.message : fallback;
  }

  private focus(id: string) {
    setTimeout(() => {
      if (!this.destroyed) document.getElementById(id)?.focus();
    }, 0);
  }
}
