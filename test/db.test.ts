/**
 * db.test.ts - openDatabase configuration
 */

import { describe, test, expect } from "vitest";
import { openDatabase } from "../src/db.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function readBusyTimeout(db: ReturnType<typeof openDatabase>): number {
  const row = db.prepare("PRAGMA busy_timeout").get() as Record<string, number>;
  const value = Object.values(row)[0];
  return typeof value === "number" ? value : Number(value);
}

describe("openDatabase", () => {
  test("sets a non-zero busy_timeout so concurrent writers wait for the lock", () => {
    const db = openDatabase(":memory:");
    try {
      expect(readBusyTimeout(db)).toBeGreaterThanOrEqual(5000);
    } finally {
      db.close();
    }
  });

  test("applies the busy_timeout to each independently opened connection", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qmd-busy-"));
    const dbPath = join(dir, "shared.sqlite");
    try {
      const a = openDatabase(dbPath);
      const b = openDatabase(dbPath);
      try {
        expect(readBusyTimeout(a)).toBeGreaterThanOrEqual(5000);
        expect(readBusyTimeout(b)).toBeGreaterThanOrEqual(5000);
      } finally {
        a.close();
        b.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("SQLite honors the configured busy_timeout when another connection holds the write lock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qmd-busy-"));
    const dbPath = join(dir, "contention.sqlite");
    try {
      const setup = openDatabase(dbPath);
      setup.exec("PRAGMA journal_mode = WAL");
      setup.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
      setup.close();

      const holder = openDatabase(dbPath);
      const waiter = openDatabase(dbPath);
      try {
        // The synchronous SQLite API blocks the thread while it waits for the
        // lock, so the test can't release the holder mid-wait. Shorten the
        // waiter's timeout so the test finishes quickly; openDatabase already
        // proved (above) that the default is >= 5000ms.
        waiter.exec("PRAGMA busy_timeout = 250");

        holder.exec("BEGIN IMMEDIATE");
        holder.prepare("INSERT INTO t (v) VALUES ('holder')").run();

        const start = Date.now();
        let threw: unknown = null;
        try {
          waiter.exec("BEGIN IMMEDIATE");
        } catch (err) {
          threw = err;
        }
        const elapsed = Date.now() - start;

        expect(threw).toBeTruthy();
        expect(elapsed).toBeGreaterThanOrEqual(200);
        expect(elapsed).toBeLessThan(2000);

        holder.exec("ROLLBACK");
      } finally {
        holder.close();
        waiter.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
