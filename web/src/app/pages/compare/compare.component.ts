import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from '../../core/services/api.service';
import { CompareResult } from '../../core/services/api.models';

const CAT_COLORS: Record<string, string> = {
  food: '#f59e0b', transport: '#38bdf8', housing: '#a78bfa',
  health: '#34d399', entertainment: '#f87171',
  salary: '#10e5a0', savings: '#3b82f6', other: '#94a3b8',
};

@Component({
  selector: 'app-compare',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './compare.component.html',
  styleUrls: ['./compare.component.scss'],
})
export class CompareComponent implements OnInit {
  availableMonths: string[] = [];
  monthA    = '';
  monthB    = '';
  comparing = false;
  result:   CompareResult | null = null;
  error     = '';

  constructor(private api: ApiService) {}

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

  catColor(cat: string): string {
    return CAT_COLORS[cat.toLowerCase()] ?? CAT_COLORS['other'];
  }
}
