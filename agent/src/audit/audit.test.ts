import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuditLog, canonicalJson, verifyAuditChain } from "./audit.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "guardian-audit-"));
  directories.push(directory);
  return join(directory, "audit.sqlite");
}

describe("AuditLog", () => {
  it("canonicalizes object keys and bigint values deterministically", () => {
    expect(canonicalJson({ z: 2n, a: { d: true, c: "x" } })).toBe('{"a":{"c":"x","d":true},"z":"2"}');
  });

  it("appends a verifiable sha256 chain", () => {
    const log = new AuditLog(databasePath());
    const first = log.append({ timestamp: "2026-10-15T00:00:00.000Z", kind: "policy", data: { route: "EXECUTE" } });
    const second = log.append({ timestamp: "2026-10-15T00:00:01.000Z", kind: "transaction", data: { amount: 7n } });

    expect(first.prevHash).toBe("0".repeat(64));
    expect(second.prevHash).toBe(first.hash);
    expect(log.verify()).toEqual({ valid: true, count: 2 });
    expect(verifyAuditChain(log.list())).toEqual({ valid: true, count: 2 });
    log.close();
  });

  it("prevents update and delete and detects out-of-band corruption", () => {
    const path = databasePath();
    const log = new AuditLog(path);
    log.append({ timestamp: "2026-10-15T00:00:00.000Z", kind: "policy", data: { safe: true } });
    log.close();

    const db = new Database(path);
    expect(() => db.prepare("UPDATE audit_entries SET hash = ? WHERE id = 1").run("f".repeat(64))).toThrow();
    db.exec("DROP TRIGGER audit_entries_no_update");
    db.prepare("UPDATE audit_entries SET hash = ? WHERE id = 1").run("f".repeat(64));
    db.close();

    const reopened = new AuditLog(path);
    expect(reopened.verify()).toMatchObject({ valid: false, count: 0 });
    reopened.close();
  });
});
