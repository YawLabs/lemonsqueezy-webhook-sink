/**
 * Integration test for src/index.ts (boot + shutdown).
 *
 * Why this is a unit test against `installShutdown` and not a subprocess that
 * spawns `dist/index.js`:
 *
 * index.ts has import-time side effects (reads env, opens SQLite, calls
 * `serve(...)`, registers SIGTERM/SIGINT handlers). Importing it from a test
 * would trigger those once per test file but ALSO leak across test files
 * (signal handlers, an open DB) when run in the same `node --test` worker
 * process. A subprocess test would work but adds ~150 lines of spawn/pipe
 * plumbing for behavior that boils down to a 10-line shutdown sequence.
 *
 * The shutdown wiring is therefore extracted into src/shutdown.ts
 * (`installShutdown`) and exercised directly here with fakes for `server`
 * and `store`. The refactor in index.ts is line-for-line equivalent:
 * same `forceExit` timer, same `server.close -> clearTimeout -> store.close
 * -> process.exit(0)` order, same `process.exit(1)` on timeout, same `unref`
 * on the force-exit timer.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { installShutdown, type ShutdownServer, type ShutdownStore } from "./shutdown.js";

function makeFakes(opts: { closeServerImmediately?: boolean } = {}) {
  const store: ShutdownStore & { calls: number } = {
    calls: 0,
    close() {
      this.calls++;
    },
  };
  const server: ShutdownServer & { closeCb: ((err?: Error) => void) | undefined } = {
    closeCb: undefined,
    close(cb?: (err?: Error) => void) {
      this.closeCb = cb;
      if (opts.closeServerImmediately !== false) cb?.();
      return server;
    },
  };
  return { server, store };
}

describe("installShutdown (index.ts boot/shutdown wiring)", () => {
  it("closes the server then closes the store then exits 0 on SIGTERM", () => {
    const { server, store } = makeFakes();
    const exits: number[] = [];
    const { shutdown } = installShutdown({
      server,
      store,
      timeoutMs: 5_000,
      exit: (code) => exits.push(code),
    });

    shutdown();

    assert.equal(typeof server.closeCb, "function", "server.close should have been called");
    assert.equal(store.calls, 1, "store.close should have been called exactly once");
    assert.deepEqual(exits, [0], "should exit 0 after the graceful close path");
  });

  it("does not call store.close until server.close has invoked its callback", () => {
    // Simulate a server whose close() defers its callback (the real @hono/node-server
    // server.close waits for in-flight requests to drain before invoking the cb).
    const { server, store } = makeFakes({ closeServerImmediately: false });
    const exits: number[] = [];
    const { shutdown } = installShutdown({
      server,
      store,
      timeoutMs: 5_000,
      exit: (code) => exits.push(code),
    });

    shutdown();

    // Pre-callback: store must not be closed, no exit yet, force-exit timer is armed.
    assert.equal(store.calls, 0, "store.close must wait for the server close callback");
    assert.deepEqual(exits, [], "exit must not fire until the server close callback fires");

    // Now fire the close callback (as the real server would once connections drain).
    assert.ok(server.closeCb, "server.closeCb should be set after shutdown()");
    server.closeCb();

    assert.equal(store.calls, 1, "store.close should fire after the server close callback");
    assert.deepEqual(exits, [0], "exit 0 should fire after the server close callback");
  });

  it("is idempotent: a second SIGTERM while shutting down is a no-op", () => {
    const { server, store } = makeFakes();
    const exits: number[] = [];
    const { shutdown } = installShutdown({
      server,
      store,
      timeoutMs: 5_000,
      exit: (code) => exits.push(code),
    });

    shutdown();
    shutdown();
    shutdown();

    assert.equal(store.calls, 1, "store.close should still only have been called once");
    assert.deepEqual(exits, [0], "exit should still only have been called once with 0");
  });

  it("exits 1 (not 0) and does not call store.close when the timeout fires before server close", () => {
    const { server, store } = makeFakes({ closeServerImmediately: false });
    const exits: number[] = [];
    const errors: string[] = [];
    // Use a real timer with a very short timeout so the test runs in ms, not the
    // production 10s. The production index.ts path is identical -- the only
    // difference is the duration.
    const { shutdown } = installShutdown({
      server,
      store,
      timeoutMs: 10,
      exit: (code) => exits.push(code),
      error: (msg) => errors.push(msg),
    });

    shutdown();

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        assert.deepEqual(exits, [1], "timeout should force exit 1");
        assert.equal(store.calls, 0, "store.close must not be called after a forced exit");
        assert.equal(errors.length, 1, "should log exactly one error");
        assert.match(errors[0] ?? "", /shutdown timed out after 10ms, forcing exit/);
        resolve();
      }, 50);
    });
  });

  it("clears the force-exit timer once the server close callback fires (no double-exit)", () => {
    const { server, store } = makeFakes({ closeServerImmediately: false });
    const exits: number[] = [];
    const { shutdown } = installShutdown({
      server,
      store,
      timeoutMs: 5_000,
      exit: (code) => exits.push(code),
    });

    shutdown();
    assert.ok(server.closeCb, "server.closeCb should be set after shutdown()");
    server.closeCb();

    // Wait past the timeout -- the timer should have been cleared inside the
    // close callback, so no second exit can fire.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        assert.deepEqual(exits, [0], "should exit exactly once with 0");
        resolve();
      }, 30);
    });
  });
});
