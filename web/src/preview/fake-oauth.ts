/**
 * A stand-in for angular-oauth2-oidc's OAuthService, used only by the
 * `preview` build configuration (see app.config.preview.ts). It satisfies
 * every OAuthService member the app actually calls, so the whole app can
 * run against sample data with no Authentik in the loop.
 *
 * Grepped from web/src/app for `oauthService.` / `OAuthService`:
 * hasValidAccessToken, getIdentityClaims, getAccessToken, logOut,
 * initCodeFlow, configure, loadDiscoveryDocumentAndTryLogin.
 */
export const fakeOAuth = {
  hasValidAccessToken(): boolean {
    return true;
  },
  getIdentityClaims(): Record<string, unknown> {
    return { name: 'Sample Owner', email: 'owner@example.com' };
  },
  getAccessToken(): string {
    return 'preview';
  },
  logOut(): void {
    // No real session to end in preview.
  },
  initCodeFlow(): void {
    // Never redirects to Authentik in preview.
  },
  configure(): void {
    // Nothing to configure: app.config.preview.ts skips the app initializer entirely.
  },
  loadDiscoveryDocumentAndTryLogin(): Promise<boolean> {
    return Promise.resolve(true);
  },
};
