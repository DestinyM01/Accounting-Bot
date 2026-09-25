import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { SettingsView } from '../../../core/services/api.models';

type AccountsView = SettingsView['accounts'];
type ListKey = 'cash' | 'senders';

const MAX_ENTRIES = 20;

/** Settings › Your accounts: the identifiers that tell your own transfers from real spending. */
@Component({
  selector: 'app-accounts-section',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  templateUrl: './accounts-section.component.html',
  styleUrls: ['../settings-section.scss'],
})
export class AccountsSectionComponent implements OnInit, OnDestroy {
  view: AccountsView | null = null;
  loading = true;
  loadError = '';
  cash: string[] = [];
  senders: string[] = [];
  draft: Record<ListKey, string> = { cash: '', senders: '' };
  draftError: Record<ListKey, string> = { cash: '', senders: '' };
  confirmEmpty = false;
  confirmReset = false;
  saving = false;
  saveError = '';
  saved = '';

  private gen = 0;
  private destroyed = false;
  private readonly subs = new Subscription();

  constructor(private readonly api: ApiService) {}

  ngOnInit() {
    this.load();
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.subs.unsubscribe();
  }

  get dirty(): boolean {
    const v = this.view;
    if (!v) return false;
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
    return !same(this.cash, v.cash.value) || !same(this.senders, v.senders.value);
  }

  /** Whether either list is currently a saved override, so resetting to config means something. */
  get savedHere(): boolean {
    const v = this.view;
    return !!v && (v.cash.source === 'saved' || v.senders.source === 'saved');
  }

  /** Why a value can't be added (the api's own rules), or '' when it can. */
  problem(list: ListKey, v: string): string {
    if (!v) return 'Type a value first.';
    if (list === 'cash' && !/^\d{4}$/.test(v)) return 'Use the last 4 digits, like 1234.';
    if (list === 'senders' && v.length < 3) return 'Use at least 3 characters.';
    if (list === 'senders' && v.length > 40) return 'Use at most 40 characters.';
    if (this[list].some((x) => x.toLowerCase() === v.toLowerCase())) return `${v} is already listed.`;
    if (this[list].length >= MAX_ENTRIES) return `At most ${MAX_ENTRIES} entries.`;
    return '';
  }

  add(list: ListKey) {
    this.confirmEmpty = false;
    const v = this.draft[list].trim();
    const problem = this.problem(list, v);
    this.draftError[list] = problem;
    if (problem) return;
    this[list] = [...this[list], v];
    this.draft[list] = '';
    this.saved = '';
    this.focus(`${list}-input`);
  }

  remove(list: ListKey, index: number) {
    this.confirmEmpty = false;
    this[list] = this[list].filter((_, i) => i !== index);
    this.saved = '';
    const left = this[list].length;
    this.focus(...(left ? [`${list}-remove-${Math.min(index, left - 1)}`] : []), `${list}-input`);
  }

  save() {
    if (!this.dirty || this.saving) return;
    if (this.cash.length === 0 && !this.confirmEmpty) {
      this.confirmEmpty = true;
      this.focus('accounts-confirm-yes');
      return;
    }
    this.confirmEmpty = false;
    this.saving = true;
    this.saveError = '';
    this.saved = '';
    this.subs.add(
      this.api.saveAccountSettings({ cash: this.cash, senders: this.senders }).subscribe({
        next: (s) => {
          this.saving = false;
          this.apply(s.accounts);
          this.saved = 'Saved. It applies to mail read from now on.';
          this.focus('cash-input'); // Save is disabled again, so focus moves to the form
        },
        error: (e: HttpErrorResponse) => {
          this.saving = false;
          this.saveError = this.message(e, "Couldn't save. Please try again.");
          this.focus('accounts-save');
        },
      }),
    );
  }

  cancelEmpty() {
    this.confirmEmpty = false;
    this.focus('accounts-save');
  }

  /** First click asks; the second forgets the saved lists so the section follows the server's config again. */
  resetToConfig() {
    if (!this.confirmReset) {
      this.confirmReset = true;
      this.focus('accounts-reset-yes');
      return;
    }
    this.confirmReset = false;
    this.saving = true;
    this.saveError = '';
    this.saved = '';
    this.subs.add(
      this.api.resetAccountSettings().subscribe({
        next: (s) => {
          this.saving = false;
          this.apply(s.accounts);
          this.saved = "Now following the server's config.";
          this.focus('cash-input');
        },
        error: (e: HttpErrorResponse) => {
          this.saving = false;
          this.saveError = this.message(e, "Couldn't reset. Please try again.");
          this.focus('accounts-save');
        },
      }),
    );
  }

  private apply(v: AccountsView) {
    this.view = v;
    this.cash = [...v.cash.value];
    this.senders = [...v.senders.value];
  }

  private load() {
    const gen = ++this.gen;
    this.subs.add(
      this.api.getSettings().subscribe({
        next: (s) => {
          if (gen !== this.gen) return;
          this.apply(s.accounts);
          this.loading = false;
          this.loadError = '';
        },
        error: () => {
          if (gen !== this.gen) return;
          this.loading = false;
          this.loadError = "Couldn't load your accounts.";
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
