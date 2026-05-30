import { Injectable } from '@angular/core';
import { ApiService } from './api.service';

interface CategoryDef { color: string; icon: string; }

@Injectable({ providedIn: 'root' })
export class CategoryService {
  /** Built-in definitions — single source of truth for the whole web app. */
  private readonly BUILT_IN: Record<string, CategoryDef> = {
    food:          { color: '#10e5a0', icon: 'restaurant'       },
    transport:     { color: '#fb923c', icon: 'directions_car'   },
    housing:       { color: '#38bdf8', icon: 'home'             },
    health:        { color: '#a78bfa', icon: 'medical_services' },
    entertainment: { color: '#f472b6', icon: 'movie'            },
    salary:        { color: '#10e5a0', icon: 'payments'         },
    savings:       { color: '#34d399', icon: 'savings'          },
    other:         { color: '#94a3b8', icon: 'receipt_long'     },
  };

  private customMap: Record<string, CategoryDef> = {};
  private _all: { name: string; color: string; icon: string; isBuiltIn: boolean }[] =
    Object.entries(this.BUILT_IN).map(([name, d]) => ({ name, ...d, isBuiltIn: true }));

  constructor(private readonly api: ApiService) {}

  /**
   * Call once from AppComponent.ngOnInit().
   * Non-blocking — built-ins are available immediately; custom categories
   * populate in the background once the API responds.
   */
  load(): void {
    this.api.getCategories().subscribe({
      next: (cats) => {
        const custom = cats.filter((c) => !c.isBuiltIn);
        custom.forEach((c) => {
          this.customMap[c.name.toLowerCase()] = { color: c.color, icon: 'label' };
        });
        this._all = [
          ...Object.entries(this.BUILT_IN).map(([name, d]) => ({ name, ...d, isBuiltIn: true })),
          ...custom.map((c) => ({ name: c.name, color: c.color, icon: 'label', isBuiltIn: false })),
        ];
      },
    });
  }

  color(name: string): string {
    const n = name.toLowerCase();
    return this.BUILT_IN[n]?.color ?? this.customMap[n]?.color ?? '#64748b';
  }

  icon(name: string): string {
    const n = name.toLowerCase();
    return this.BUILT_IN[n]?.icon ?? 'label';
  }

  /** All categories — built-ins first, then custom. Use in dropdowns. */
  get all(): { name: string; color: string; icon: string; isBuiltIn: boolean }[] {
    return this._all;
  }
}
