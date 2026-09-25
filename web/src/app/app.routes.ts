import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/dashboard/dashboard.component').then((m) => m.DashboardComponent),
  },
  {
    path: 'balance',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/balance/balance.component').then((m) => m.BalanceComponent),
  },
  {
    path: 'transactions',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/transactions/transactions.component').then((m) => m.TransactionsComponent),
  },
  {
    path: 'budget',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/budget/budget.component').then((m) => m.BudgetComponent),
  },
  {
    path: 'statistics',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/statistics/statistics.component').then((m) => m.StatisticsComponent),
  },
  {
    path: 'compare',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/compare/compare.component').then((m) => m.CompareComponent),
  },
  {
    path: 'analytics',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/analytics/analytics.component').then((m) => m.AnalyticsComponent),
  },
  {
    path: 'tips',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/tips/tips.component').then((m) => m.TipsComponent),
  },
  {
    path: 'calculator',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/calculator/calculator.component').then((m) => m.CalculatorComponent),
  },
  {
    path: 'settings',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/settings/settings.component').then((m) => m.SettingsComponent),
  },
  {
    path: 'recurring',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/recurring/recurring.component').then((m) => m.RecurringComponent),
  },
  {
    path: 'categories',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/categories/categories.component').then((m) => m.CategoriesComponent),
  },
  {
    path: 'merchants',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/merchants/merchants.component').then((m) => m.MerchantsComponent),
  },
];
