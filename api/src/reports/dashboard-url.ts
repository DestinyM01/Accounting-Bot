/** The web app's address, for links in emails, without a trailing slash. Same variable and default as the CORS origin in main.ts. */
export function dashboardUrl(): string {
  return (process.env.CORS_ORIGIN || 'https://bot.andujaronline.uk').replace(/\/+$/, '');
}
