import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { CompareResult } from '../../core/services/api.models';
import { CategoryService } from '../../core/services/category.service';
import { changeTone } from '../../core/ui/change-tone';
import { IconComponent } from '../../core/ui/icon/icon.component';

@Component({
    selector: 'app-compare',
    imports: [CommonModule, FormsModule, IconComponent],
    templateUrl: './compare.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./compare.component.scss']
})
export class CompareComponent implements OnInit {
  availableMonths: string[] = [];
  monthA    = '';
  monthB    = '';
  comparing = false;
  result:   CompareResult | null = null;
  error     = '';

  constructor(private api: ApiService, private catSvc: CategoryService) {}

  ngOnInit() {
    this.api.getCompareMonths().subscribe({
      next: (months) => { this.availableMonths = months; },
      error: () => {},
    });
  }

  get canCompare(): boolean {
    return !!this.monthA && !!this.monthB && this.monthA !== this.monthB;
  }

  compare() {
    this.comparing = true;
    this.error     = '';
    this.result    = null;
    this.api.compare(this.monthA, this.monthB).subscribe({
      next:  (res) => { this.result = res; this.comparing = false; },
      error: ()    => {
        this.error     = 'Failed to compare periods. Please try again.';
        this.comparing = false;
      },
    });
  }

  formatMonth(ym: string): string {
    const [year, month] = ym.split('-').map(Number);
    return new Date(year, month - 1, 1)
      .toLocaleString('en', { month: 'long', year: 'numeric' });
  }

  catColor(cat: string): string { return this.catSvc.color(cat); }

  // ── Difference row: monthB minus monthA ──────────────────────────────────
  // Same good/bad tone pattern as Dashboard's tone()/badgeLabel(): the sign of
  // the change is shown as-is, but which sign counts as "good" depends on the
  // metric — more income or a better net is good, more expense is bad.
  get diffIncome(): number {
    return this.result ? this.result.monthB.totalIncome - this.result.monthA.totalIncome : 0;
  }

  get diffExpenses(): number {
    return this.result ? this.result.monthB.totalExpenses - this.result.monthA.totalExpenses : 0;
  }

  get diffNet(): number {
    return this.result ? this.result.monthB.net - this.result.monthA.net : 0;
  }

  get incomeDiffTone(): 'pos' | 'neg' | 'neutral' { return changeTone(this.diffIncome, true); }
  get expenseDiffTone(): 'pos' | 'neg' | 'neutral' { return changeTone(this.diffExpenses, false); }
  get netDiffTone():     'pos' | 'neg' | 'neutral' { return changeTone(this.diffNet, true); }
}
