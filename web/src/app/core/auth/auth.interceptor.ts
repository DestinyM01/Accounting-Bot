import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { OAuthService } from 'angular-oauth2-oidc';
import { catchError, throwError } from 'rxjs';

// Module-level flag — prevents multiple parallel 401s each calling
// initCodeFlow(), which would overwrite the nonce and cause an
// invalid_nonce_in_state loop.
let redirectingToLogin = false;

/** Attaches the Authentik Bearer token to every /api/* request.
 *  On 401, triggers one full re-login. Guard prevents the loop caused
 *  by concurrent requests all firing initCodeFlow() simultaneously. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const oauthService = inject(OAuthService);
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
        }
        return throwError(() => err);
      }),
    );
  }

  return next(req);
};
