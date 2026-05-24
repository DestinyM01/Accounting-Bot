import { APP_INITIALIZER, ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideOAuthClient, OAuthService } from 'angular-oauth2-oidc';
import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
import { authConfig } from './core/auth/auth.config';

/**
 * Bootstrap OIDC before the router activates any route.
 * APP_INITIALIZER blocks the app until the returned Promise resolves,
 * so by the time authGuard runs the discovery document is already loaded
 * and initCodeFlow() can safely redirect to Authentik.
 */
function initializeAuth(oauth: OAuthService): () => Promise<void> {
  return () => {
    oauth.configure(authConfig);
    oauth.setupAutomaticSilentRefresh();
    // loadDiscoveryDocumentAndTryLogin handles the ?code= callback on return
    // from Authentik as well as normal page loads.
    return oauth.loadDiscoveryDocumentAndTryLogin().then(() => void 0);
  };
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideAnimations(),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideOAuthClient(),
    {
      provide: APP_INITIALIZER,
      useFactory: initializeAuth,
      deps: [OAuthService],
      multi: true,
    },
  ],
};
