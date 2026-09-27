import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { OAuthService } from 'angular-oauth2-oidc';
import { catchError, throwError } from 'rxjs';

// Module-level flag — prevents multiple parallel 401s each calling
// initCodeFlow(), which would overwrite the nonce and cause an
// invalid_nonce_in_state loop.
let redirectingToLogin = false;

// Similar idea for 403: the api is owner-only, so every /api call from a valid-but-not-owner
// login fails the same way. Several requests failing around the same time (a page that fires
// more than one on load) would each call navigateByUrl(); this flag only covers those
// concurrent 403s while that one navigation runs, and is cleared once it settles. Unlike the
// 401 case it is not one-time: if the user leaves /not-allowed (Back, a typed url) and the
// next page's request 403s too, that redirects again.
let redirectingToNotAllowed = false;

/** Attaches the Authentik Bearer token to every /api/* request.
 *  On 401, triggers one full re-login. Guard prevents the loop caused
 *  by concurrent requests all firing initCodeFlow() simultaneously.
 *  On 403 (a valid login that isn't the configured owner), navigates to /not-allowed. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const oauthService = inject(OAuthService);
  const router = inject(Router);
  const token = oauthService.getAccessToken();

  if (token && req.url.startsWith('/api')) {
    const authReq = req.clone({
      setHeaders: { Authorization: `Bearer ${token}` },
    });
    return next(authReq).pipe(
      catchError((err: HttpErrorResponse) => {
        if (err.status === 401 && !redirectingToLogin) {
          redirectingToLogin = true;
          oauthService.initCodeFlow();
        } else if (err.status === 403 && !redirectingToNotAllowed && router.url !== '/not-allowed') {
          redirectingToNotAllowed = true;
          router.navigateByUrl('/not-allowed').finally(() => { redirectingToNotAllowed = false; });
        }
        return throwError(() => err);
      }),
    );
  }

  return next(req);
};
