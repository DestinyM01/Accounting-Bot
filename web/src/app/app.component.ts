import { Component, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { OAuthService } from 'angular-oauth2-oidc';
import { authConfig } from './core/auth/auth.config';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatSidenavModule,
    MatToolbarModule,
    MatIconModule,
    MatListModule,
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements OnInit {
  navItems = [
    { label: 'Dashboard',     icon: 'dashboard',      path: '/dashboard' },
    { label: 'Transactions',  icon: 'receipt_long',   path: '/transactions' },
    { label: 'Budget',        icon: 'account_balance_wallet', path: '/budget' },
    { label: 'Statistics',    icon: 'bar_chart',      path: '/statistics' },
  ];

  get userName() {
    const claims = this.oauthService.getIdentityClaims() as any;
    return claims?.name || claims?.preferred_username || 'User';
  }

  constructor(private oauthService: OAuthService) {}

  ngOnInit() {
    this.oauthService.configure(authConfig);
    this.oauthService.setupAutomaticSilentRefresh();
    this.oauthService.loadDiscoveryDocumentAndTryLogin();
  }

  logout() {
    this.oauthService.logOut();
  }
}
