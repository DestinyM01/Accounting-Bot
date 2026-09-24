import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

/** Emits after any transaction write so open pages can reload immediately. */
@Injectable({ providedIn: 'root' })
export class TransactionEventsService {
  private readonly changedSubject = new Subject<void>();
  readonly changed$ = this.changedSubject.asObservable();
  notify(): void { this.changedSubject.next(); }
}
