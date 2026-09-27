import { Component, HostListener, OnInit, ChangeDetectionStrategy, inject } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router, NavigationStart, NavigationEnd } from '@angular/router';
import { CommonModule, Location } from '@angular/common';
import { OAuthService } from 'angular-oauth2-oidc';
import { ApiService } from './core/services/api.service';
import { CategoryService } from './core/services/category.service';
import { BudgetEntry } from './core/services/api.models';
import { filter } from 'rxjs/operators';
import { FabComponent } from './core/ui/fab/fab.component';
import { TransactionFormComponent } from './core/ui/transaction-form/transaction-form.component';
import { IconComponent } from './core/ui/icon/icon.component';
import { ThemeService } from './core/ui/theme.service';

interface NavItem { label: string; icon: string; path: string; }
interface NavGroup { label: string; items: NavItem[]; }

@Component({
    selector: 'app-root',
    imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, IconComponent, FabComponent, TransactionFormComponent],
    templateUrl: './app.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./app.component.scss'],
    host: {
      // Lets a global stylesheet hide the FAB while the phone sheet covers the screen.
      '[class.shell-sheet-open]': 'sheetOpen',
    },
})
export class AppComponent implements OnInit {
  // ── Nav model ────────────────────────────────────────────────────────
  primaryNav: NavItem[] = [
    { label: 'Dashboard',    icon: 'layout-dashboard', path: '/dashboard' },
    { label: 'Transactions', icon: 'receipt',          path: '/transactions' },
    { label: 'Balance',      icon: 'building-bank',    path: '/balance' },
    { label: 'Budget',       icon: 'wallet',           path: '/budget' },
    { label: 'Recurring',    icon: 'repeat',           path: '/recurring' },
  ];

  navGroups: NavGroup[] = [
    {
      label: 'Insights',
      items: [
        { label: 'Statistics',        icon: 'chart-bar',    path: '/statistics' },
        { label: 'Compare',           icon: 'arrows-diff',  path: '/compare' },
        { label: 'Analytics',         icon: 'chart-dots-3', path: '/analytics' },
        { label: 'Tips',              icon: 'bulb',         path: '/tips' },
        { label: 'Growth calculator', icon: 'pig-money',    path: '/calculator' },
      ],
    },
    {
      label: 'Manage',
      items: [
        { label: 'Categories', icon: 'tag',           path: '/categories' },
        { label: 'Merchants',  icon: 'building-store', path: '/merchants' },
      ],
    },
  ];

  // Declared before currentUrl so it's already injected when currentUrl's initialiser runs.
  private readonly location = inject(Location);

  // Seeded from the browser's real path, not router.url: router.url is still '/' until the
  // first NavigationEnd, so a direct load of /not-allowed would otherwise miss isNotAllowed in
  // ngOnInit (firing the category load) and render the full shell until that navigation ends.
  // NavigationEnd keeps it current from then on.
  currentUrl = this.location.path() || '/';

  // While true, the shell renders only the brand and Log out (see app.component.html) —
  // no nav, no notifications, no FAB — because a 403 landed the user here and every other
  // control just points at pages the api will refuse just the same.
  get isNotAllowed(): boolean {
    return this.currentUrl === '/not-allowed';
  }

  isGroupActive(group: NavGroup): boolean {
    return group.items.some((i) => this.currentUrl === i.path || this.currentUrl.startsWith(i.path + '/'));
  }

  // ── Dropdown menus (nav groups, notifications, settings) ─────────────────
  // Only one open at a time, identified by the group label ('Insights' /
  // 'Manage') or a fixed id ('notifications' / 'settings').
  openMenu: string | null = null;
  private openMenuBtn: HTMLElement | null = null;

  toggleMenu(id: string, btn: HTMLElement) {
    if (this.openMenu === id) { this.closeMenu(); return; }
    this.openMenu = id;
    this.openMenuBtn = btn;
    if (id === 'notifications' && !this.notifLoaded) this.loadNotifications();
    // Focus the first item once the menu has rendered.
    setTimeout(() => document.querySelector<HTMLElement>('[role="menu"] [role="menuitem"]')?.focus());
  }

  closeMenu(returnFocus = false) {
    const btn = this.openMenuBtn;
    this.openMenu = null;
    this.openMenuBtn = null;
    if (returnFocus) btn?.focus();
  }

  onMenuKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); this.closeMenu(true); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const container = e.currentTarget as HTMLElement;
    const items = Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    if (!items.length) return;
    e.preventDefault();
    const idx = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? (idx + 1 + items.length) % items.length : (idx - 1 + items.length) % items.length;
    items[next]?.focus();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(e: MouseEvent) {
    if (!this.openMenu) return;
    // composedPath() (not e.target.closest()) because the icon glyph inside the clicked
    // button can be detached and reattached by change detection between the click and this
    // handler running; closest() on a detached node would never find .shell-menu-wrap and
    // would close the menu the instant it was clicked open. composedPath() reflects the DOM
    // as it was when the event was dispatched, so it's unaffected by any later detachment.
    const inside = e.composedPath().some((n) => n instanceof Element && n.classList.contains('shell-menu-wrap'));
    if (!inside) this.closeMenu();
  }

  @HostListener('document:keydown.escape')
  onDocumentEscape() {
    // Closes a menu or the sheet even when focus never made it inside them (e.g. the
    // notifications menu has nothing focusable while it's empty, so focus stays on the bell).
    if (this.openMenu) { this.closeMenu(true); return; }
    if (this.sheetOpen) { this.closeSheet(); }
  }

  // ── Notifications ─────────────────────────────────────────────────────
  notifLoaded  = false;
  notifLoading = false;
  budgetAlerts: BudgetEntry[] = [];

  private loadNotifications() {
    this.notifLoading = true;
    const m = new Date().getMonth() + 1;
    const y = new Date().getFullYear();
    this.api.getBudget(m, y).subscribe({
      next: (data) => {
        this.budgetAlerts = data.filter(b => b.percentage >= 75).sort((a, b) => b.percentage - a.percentage);
        this.notifLoaded = true;
        this.notifLoading = false;
      },
      error: () => { this.notifLoading = false; this.notifLoaded = true; },
    });
  }

  get notifCount(): number { return this.budgetAlerts.length; }

  // Compositor-friendly fill: scaleX(0..1) instead of animating width.
  budgetBarBg(pct: number): string {
    return pct >= 100 ? 'var(--neg)' : 'var(--warn)';
  }

  budgetBarScale(pct: number): number {
    return (pct > 100 ? 100 : pct) / 100;
  }

  // ── Settings / auth ───────────────────────────────────────────────────
  get authentikProfileUrl(): string {
    return 'https://auth.andujaronline.uk/if/user/';
  }

  get claims()   { return this.oauthService.getIdentityClaims() as any; }
  get userName() { return this.claims?.name || this.claims?.preferred_username || 'User'; }
  get userEmail(){ return this.claims?.email || ''; }
  get initials(): string {
    const parts = this.userName.trim().split(/\s+/);
    return parts.length >= 2
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : this.userName.slice(0, 2).toUpperCase();
  }

  logout() { this.oauthService.logOut(); }

  // ── Phone sheet ───────────────────────────────────────────────────────
  sheetOpen = false;
  private sheetBtn: HTMLElement | null = null;

  toggleSheet(btn: HTMLElement) {
    this.sheetOpen = !this.sheetOpen;
    document.body.style.overflow = this.sheetOpen ? 'hidden' : '';
    if (this.sheetOpen) {
      this.sheetBtn = btn;
      setTimeout(() => document.querySelector<HTMLElement>('.shell-sheet-link')?.focus());
    }
  }

  closeSheet() {
    if (!this.sheetOpen) return;
    this.sheetOpen = false;
    document.body.style.overflow = '';
    this.sheetBtn?.focus();
  }

  // The toggle button lives outside .shell-sheet (it opens the sheet), so it isn't among the
  // container's own querySelectorAll('a, button') results; it's stitched in as the trap's
  // first stop so Tab/Shift+Tab cycle through it too instead of leaving it unreachable.
  onSheetKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); this.closeSheet(); return; }
    if (e.key !== 'Tab') return;
    const sheetEl = document.querySelector<HTMLElement>('.shell-sheet');
    if (!sheetEl) return;
    const links = Array.from(sheetEl.querySelectorAll<HTMLElement>('a, button')).filter(el => !el.hasAttribute('disabled'));
    const focusables = this.sheetBtn ? [this.sheetBtn, ...links] : links;
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  constructor(
    private oauthService: OAuthService,
    private api: ApiService,
    private router: Router,
    private categoryService: CategoryService,
    private themeService: ThemeService,
  ) {
    // Close every open menu / the phone sheet as soon as a navigation starts. A click on a
    // sheet link already does this itself (closeSheet() moves focus to the toggle first), but
    // a navigation with no click to trigger it — browser Back chief among them — can leave the
    // sheet open and focus sitting on a link that's about to be hidden; move focus somewhere
    // visible rather than leaving it stranded.
    //
    // The body-scroll-lock reset only runs when the sheet itself had it locked: the
    // transaction form (see TransactionFormComponent) locks the same body.style.overflow
    // while it's open and closes itself on this same NavigationStart, and unconditionally
    // clearing it here first would release the form's lock a tick early — letting the page
    // scroll behind it for that one frame before the form's own close() clears it again.
    this.router.events
      .pipe(filter(e => e instanceof NavigationStart))
      .subscribe(() => {
        const wasOpen = this.sheetOpen;
        this.sheetOpen = false;
        this.openMenu = null;
        this.openMenuBtn = null;
        if (wasOpen) {
          document.body.style.overflow = '';
          if ((document.activeElement as HTMLElement | null)?.closest('.shell-sheet')) {
            (this.sheetBtn ?? document.querySelector<HTMLElement>('.shell-main'))?.focus();
          }
        }
      });

    // Track the active url so group buttons can show themselves as active.
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => { this.currentUrl = e.urlAfterRedirects; });
  }

  ngOnInit() {
    // Skipped when the app boots straight into /not-allowed (e.g. a refresh there): the
    // request would just 403 like any other and add nothing, since this page never renders
    // anything that needs a category name or color.
    if (this.oauthService.hasValidAccessToken() && !this.isNotAllowed) {
      this.categoryService.load();
    }
  }
}
