/**
 * Graceful shutdown wiring, extracted from index.ts so the close/store sequence
 * can be unit-tested without booting the HTTP server.
 */

export interface ShutdownServer {
  close(callback?: (err?: Error) => void): unknown;
}

export interface ShutdownStore {
  close(): unknown;
}

export interface ShutdownDeps {
  server: ShutdownServer;
  store: ShutdownStore;
  timeoutMs?: number;
  exit?: (code: number) => void;
  error?: (msg: string) => void;
}

/**
 * Build a one-shot shutdown handler. Returns a function and a `disarm` callback
 * that clears the force-exit timer without exiting -- callers wire `disarm` to
 * fire when the graceful path completes (process exit ends the timer anyway).
 *
 * The returned handler is idempotent: a second call is a no-op so repeated
 * SIGTERMs don't double-close the store.
 */
export function installShutdown(deps: ShutdownDeps): { shutdown: () => void; disarm: () => void } {
  const timeoutMs = deps.timeoutMs ?? 10_000;
  const exit = deps.exit ?? ((code) => process.exit(code));
  const error = deps.error ?? ((msg) => console.error(msg));

  let armed: ReturnType<typeof setTimeout> | null = null;
  let done = false;

  const shutdown = () => {
    if (done) return;
    done = true;
    armed = setTimeout(() => {
      error(`shutdown timed out after ${timeoutMs}ms, forcing exit`);
      exit(1);
    }, timeoutMs);
    armed.unref();
    deps.server.close(() => {
      if (armed) clearTimeout(armed);
      deps.store.close();
      exit(0);
    });
  };

  const disarm = () => {
    if (armed) {
      clearTimeout(armed);
      armed = null;
    }
  };

  return { shutdown, disarm };
}
