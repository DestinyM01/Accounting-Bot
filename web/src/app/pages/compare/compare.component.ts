import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from '../../core/services/api.service';
import { CompareResult } from '../../core/services/api.models';
import { CategoryService } from '../../core/services/category.service';

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
}
