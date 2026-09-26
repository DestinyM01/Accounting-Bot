import { Logger } from '@nestjs/common';

/** How long shutdown waits for a run in flight. The pod's grace period (45 s) leaves room for the rest of shutdown. */
export const SHUTDOWN_WAIT_MS = 25_000;
const POLL_MS = 100;

/**
 * Resolves once `busy()` is false, or after `timeoutMs` with a warning. For
 * BeforeApplicationShutdown: a run cut off mid-write can leave a row without
 * its balance change. The database connection closes only after these hooks.
 */
export async function waitForIdle(busy: () => boolean, what: string, logger: Logger, timeoutMs = SHUTDOWN_WAIT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (busy()) {
    if (Date.now() >= deadline) {
      logger.warn(`Shutting down with ${what} still in flight after ${Math.round(timeoutMs / 1000)} s`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}
