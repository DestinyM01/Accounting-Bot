import { Component, HostListener } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';
import { OAuthService } from 'angular-oauth2-oidc';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from './core/services/api.service';
import { BudgetEntry } from './core/services/api.models';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, MatIconModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  navItems = [
    { label: 'Dashboard',    icon: 'dashboard',              path: '/dashboard' },
    { label: 'Transactions', icon: 'receipt_long',           path: '/transactions' },
    { label: 'Budget',       icon: 'account_balance_wallet', path: '/budget' },
    { label: 'Statistics',   icon: 'bar_chart',              path: '/statistics' },
    { label: 'Recurring',    icon: 'repeat',                 path: '/recurring' },
    { label: 'Tips',         icon: 'lightbulb',              path: '/tips' },
  ];

  // ── Sidebar collapse ──────────────────────────────────────────────────
  sidebarCollapsed = false;
  toggleSidebar() { this.sidebarCollapsed = !this.sidebarCollapsed; }

  // ── Notifications ─────────────────────────────────────────────────────
  notifOpen       = false;
  notifLoaded     = false;
  notifLoading    = false;
  budgetAlerts:   BudgetEntry[] = [];

  toggleNotifications() {
    this.notifOpen = !this.notifOpen;
    if (this.notifOpen && !this.notifLoaded) { this.loadNotifications(); }
  }

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

  // ── Settings ──────────────────────────────────────────────────────────
  settingsOpen = false;
  toggleSettings() { this.settingsOpen = !this.settingsOpen; }

  get authentikProfileUrl(): string {
    return 'https://auth.andujaronline.uk/if/user/';
  }

  // ── Close panels on outside click ────────────────────────────────────
  @HostListener('document:click', ['$event'])
  onDocClick(e: MouseEvent) {
    const t = e.target as HTMLElement;
    if (!t.closest('.notif-wrap'))   this.notifOpen    = false;
    if (!t.closest('.settings-wrap')) this.settingsOpen = false;
  }

  // ── Auth ──────────────────────────────────────────────────────────────
  get claims()   { return this.oauthService.getIdentityClaims() as any; }
  get userName() { return this.claims?.name || this.claims?.preferred_username || 'User'; }
  get userEmail(){ return this.claims?.email || ''; }
  get initials(): string {
    const parts = this.userName.trim().split(/\s+/);
    return parts.length >= 2
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : this.userName.slice(0, 2).toUpperCase();
  }

  constructor(private oauthService: OAuthService, private api: ApiService) {}

  logout() { this.oauthService.logOut(); }
}
