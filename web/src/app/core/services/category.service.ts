import { Injectable } from '@angular/core';
import { ApiService } from './api.service';

interface CategoryDef { color: string; icon: string; }

@Injectable({ providedIn: 'root' })
export class CategoryService {
  /** Built-in definitions — single source of truth for the whole web app. */
  private readonly BUILT_IN: Record<string, CategoryDef> = {
    food:          { color: '#3fb68b', icon: 'tools-kitchen-2' },
    transport:     { color: '#e08a4a', icon: 'car'             },
    housing:       { color: '#4aa3d8', icon: 'home'            },
    health:        { color: '#9b86e0', icon: 'first-aid-kit'   },
    entertainment: { color: '#d777a8', icon: 'movie'           },
    salary:        { color: '#3fb68b', icon: 'cash-banknote'   },
    savings:       { color: '#52b788', icon: 'pig-money'       },
    other:         { color: '#8b95a3', icon: 'receipt'         },
    cash:          { color: '#8fb339', icon: 'cash'            },
  };

  private customMap: Record<string, CategoryDef> = {};
  /** True once the category list has arrived; before that, custom categories are missing from `all`. */
  loaded = false;
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
        this.customMap = Object.fromEntries(
          custom.map((c) => [c.name.toLowerCase(), { color: c.color, icon: 'tag' }]),
        );
        this._all = [
          ...Object.entries(this.BUILT_IN).map(([name, d]) => ({ name, ...d, isBuiltIn: true })),
          ...custom.map((c) => ({ name: c.name, color: c.color, icon: 'tag', isBuiltIn: false })),
        ];
        this.loaded = true;
      },
      // Non-critical and non-blocking (see above): swallow it rather than let it surface as an
      // unhandled console error. `loaded` stays false, its documented "still unknown" state — hit
      // on every first paint for a non-owner account, whose very first request 403s before the
      // interceptor's redirect to /not-allowed lands.
      error: () => {},
    });
  }

  color(name: string): string {
    const n = name.toLowerCase();
    return this.BUILT_IN[n]?.color ?? this.customMap[n]?.color ?? '#8b95a3';
  }

  icon(name: string): string {
    const n = name.toLowerCase();
    return this.BUILT_IN[n]?.icon ?? 'tag';
  }

  /** All categories — built-ins first, then custom. Use in dropdowns. */
  get all(): { name: string; color: string; icon: string; isBuiltIn: boolean }[] {
    return this._all;
  }
}
