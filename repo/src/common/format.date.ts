export async function toNormalDate(date: Date) {
  return new Date(date).toLocaleString('en-US', {
    timeZone: process.env.CRON_TIMEZONE || 'America/Santo_Domingo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
