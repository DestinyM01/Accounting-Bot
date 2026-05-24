import { Component } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { OAuthService } from 'angular-oauth2-oidc';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatIconModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  navItems = [
    { label: 'Dashboard',    icon: 'dashboard',              path: '/dashboard' },
    { label: 'Transactions', icon: 'receipt_long',           path: '/transactions' },
    { label: 'Budget',       icon: 'account_balance_wallet', path: '/budget' },
    { label: 'Statistics',   icon: 'bar_chart',              path: '/statistics' },
  ];

  get claims() { return this.oauthService.getIdentityClaims() as any; }

  get userName() {
    return this.claims?.name || this.claims?.preferred_username || 'User';
  }

  get initials(): string {
    const parts = this.userName.trim().split(/\s+/);
    return parts.length >= 2
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : this.userName.slice(0, 2).toUpperCase();
  }

  constructor(private oauthService: OAuthService) {}

  logout() { this.oauthService.logOut(); }
}
