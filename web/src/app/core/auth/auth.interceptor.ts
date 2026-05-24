import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { OAuthService } from 'angular-oauth2-oidc';
import { catchError, throwError } from 'rxjs';

/** Attaches the Authentik Bearer token to every /api/* request.
 *  On 401, triggers a full re-login (silent refresh is blocked by
 *  Authentik's X-Frame-Options: deny header). */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const oauthService = inject(OAuthService);
  const token = oauthService.getAccessToken();

  if (token && req.url.startsWith('/api')) {
    const authReq = req.clone({
      setHeaders: { Authorization: `Bearer ${token}` },
    });
    return next(authReq).pipe(
      catchError((err: HttpErrorResponse) => {
        if (err.status === 401) {
          oauthService.initCodeFlow();
        }
        return throwError(() => err);
      }),
    );
  }

  return next(req);
};
