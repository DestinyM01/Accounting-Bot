import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors, withXhr } from '@angular/common/http';
import { OAuthService } from 'angular-oauth2-oidc';
import { routes } from '../app/app.routes';
import { authInterceptor } from '../app/core/auth/auth.interceptor';
import { previewApiInterceptor } from './preview-api.interceptor';
import { fakeOAuth } from './fake-oauth';

/**
 * Swapped in for src/app/app.config.ts by the `preview` build configuration
 * (see angular.json's fileReplacements). It keeps the real router, but
 * answers every /api call from an in-memory store instead of the real api,
 * and stands in a fake OAuthService so the app never redirects to Authentik.
 * There is no app initializer here on purpose: the real one blocks the app
 * on `loadDiscoveryDocumentAndTryLogin()`, which preview has no discovery
 * document for.
 *
 * The real authInterceptor runs here too, ahead of previewApiInterceptor: it only attaches a
 * (harmless, fake) bearer header and watches for 401/403, so it's reusable as-is. Order matters
 * — it must wrap previewApiInterceptor (attach header, call next(), then catchError on the
 * result), not the other way around, otherwise previewApiInterceptor's canned /api replies
 * would never reach it. This is what makes accbot.preview.forbid (see
 * preview-api.interceptor.ts) actually land on /not-allowed instead of just failing silently.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideHttpClient(withXhr(), withInterceptors([authInterceptor, previewApiInterceptor])),
    { provide: OAuthService, useValue: fakeOAuth },
  ],
};
