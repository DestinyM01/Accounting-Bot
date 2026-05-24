import { AuthConfig } from 'angular-oauth2-oidc';

export const authConfig: AuthConfig = {
  issuer: 'https://auth.andujaronline.uk/application/o/bot-angular-auth/',
  redirectUri: 'https://bot.andujaronline.uk/',
  silentRefreshRedirectUri: 'https://bot.andujaronline.uk/silent-renew.html',
  clientId: 'DF1VNYRNAWGgpRai7lTVa0sVcNEgnyLA9ES0U6qA',
  responseType: 'code',
  scope: 'openid profile email',
  useSilentRefresh: true,
  silentRefreshTimeout: 5000,
  timeoutFactor: 0.75,
  // PKCE is on by default for code flow with a public client
  showDebugInformation: false,
  clearHashAfterLogin: true,
  nonceStateSeparator: 'semicolon',
  // Authentik's endpoint URLs don't all share the issuer as a prefix,
  // which fails angular-oauth2-oidc's strict discovery document check.
  strictDiscoveryDocumentValidation: false,
};
