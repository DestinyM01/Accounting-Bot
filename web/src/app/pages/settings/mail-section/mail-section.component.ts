import { Component, OnDestroy, OnInit } from '@angular/core';
import { CurrencyPipe, DatePipe, TitleCasePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { IngestionStatusView, RunCounts } from '../../../core/services/api.models';
import { CategoryService } from '../../../core/services/category.service';
import { TransactionEventsService } from '../../../core/services/transaction-events.service';

/** Settings › Bank mail: how ingestion is doing, a check on demand, and the mails it couldn't read. */
@Component({
  selector: 'app-mail-section',
  standalone: true,
  imports: [CurrencyPipe, DatePipe, TitleCasePipe, RouterLink],
  templateUrl: './mail-section.component.html',
  styleUrls: ['../settings-section.scss'],
})
export class MailSectionComponent implements OnInit, OnDestroy {
  status: IngestionStatusView | null = null;
  loading = true;
  loadError = '';
  /** A failed reload once a status is already on screen: keeps the stale status visible instead of blanking the section. */
  reloadError = '';
  checking = false;
  checkResult = '';
  checkError = '';
  /** The mail whose "Not a transaction" is waiting for a yes. */
  confirming: string | null = null;
  dismissing = false;
  dismissError = '';

  private gen = 0;
  private destroyed = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly subs = new Subscription();

  constructor(
    private readonly api: ApiService,
    private readonly catSvc: CategoryService,
    private readonly events: TransactionEventsService,
  ) {}

  ngOnInit() {
    this.load();
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.subs.unsubscribe();
    if (this.pollTimer) clearTimeout(this.pollTimer);
  }

  catColor(category: string) {
    return this.catSvc.color(category);
  }

  checkNow() {
    if (this.checking || this.status?.running) return;
    this.checking = true;
    this.checkResult = '';
    this.checkError = '';
    this.subs.add(
      this.api.runIngestion().subscribe({
        next: (c: RunCounts) => {
          this.checking = false;
          this.checkResult = `Booked ${c.created}, skipped ${c.skipped}, couldn't read ${c.failed}.`;
          if (c.created > 0) this.events.notify(); // new transactions: every list reloads
          this.load(() => this.focus('check-mail'));
        },
        error: (e: HttpErrorResponse) => {
          this.checking = false;
          this.checkError = e.status === 409 ? 'A check is already running.' : this.message(e, "Couldn't check mail. Please try again.");
          this.load(() => this.focus('check-mail'));
        },
      }),
    );
  }

  askDismiss(id: string) {
    this.confirming = id;
    this.dismissError = '';
    this.focus(`dismiss-yes-${id}`);
  }

  cancelDismiss(id: string) {
    this.confirming = null;
    this.focus(`dismiss-${id}`);
  }

  confirmDismiss(id: string) {
    if (this.dismissing) return;
    const list = this.status?.unreadable ?? [];
    const next = list[list.findIndex((m) => m.id === id) + 1]?.id;
    this.dismissing = true;
    this.dismissError = '';
    this.subs.add(
      this.api.dismissUnreadable(id).subscribe({
        next: () => {
          this.dismissing = false;
          this.confirming = null;
          this.load(() => this.focus(...(next ? [`dismiss-${next}`] : []), 'unreadable-heading'));
        },
        error: (e: HttpErrorResponse) => {
          this.dismissing = false;
          this.dismissError = this.message(e, "Couldn't dismiss it. Please try again.");
          // Focus the button that's still there for this mail, else the list heading.
          this.load(() => this.focus(`dismiss-${id}`, 'unreadable-heading'));
        },
      }),
    );
  }

  /** Reads the status; a reply older than the newest request is dropped. */
  private load(then?: () => void) {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    const gen = ++this.gen;
    this.subs.add(
      this.api.getIngestionStatus().subscribe({
        next: (s) => {
          if (gen !== this.gen) return;
          this.status = s;
          this.loading = false;
          this.loadError = '';
          this.reloadError = '';
          if (this.confirming && !s.unreadable.some((m) => m.id === this.confirming)) this.confirming = null;
          // "Check mail now" can't stay stuck: keep polling while a run is in
          // flight (this pod's or another's), until it reports done.
          if (s.running && !this.destroyed) this.pollTimer = setTimeout(() => this.load(), 4000);
          then?.();
        },
        error: () => {
          if (gen !== this.gen) return;
          this.loading = false;
          // Only the very first load has no status to fall back on; once one
          // is on screen, a failed reload keeps it and reports inline instead.
          if (this.status) this.reloadError = "Couldn't reload the mail status.";
          else this.loadError = "Couldn't load the mail status.";
          then?.();
        },
      }),
    );
  }

  private message(e: HttpErrorResponse, fallback: string): string {
    return typeof e.error?.message === 'string' ? e.error.message : fallback;
  }

  /** Focus the first of these elements that exists after the next render. */
  private focus(...ids: string[]) {
    setTimeout(() => {
      if (this.destroyed) return;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el) {
          el.focus();
          return;
        }
      }
    }, 0);
  }
}
