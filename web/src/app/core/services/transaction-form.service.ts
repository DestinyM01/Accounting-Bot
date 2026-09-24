import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { Transaction } from './api.models';

export type FormRequest = { mode: 'create' } | { mode: 'edit'; tx: Transaction };

/** Pages ask the single global form to open; the form lives in AppComponent. */
@Injectable({ providedIn: 'root' })
export class TransactionFormService {
  private readonly requests = new Subject<FormRequest>();
  readonly requests$ = this.requests.asObservable();
  openCreate(): void { this.requests.next({ mode: 'create' }); }
  openEdit(tx: Transaction): void { this.requests.next({ mode: 'edit', tx }); }
}
