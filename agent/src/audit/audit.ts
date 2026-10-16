import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

export type JsonValue = null | boolean | number | string | bigint | JsonValue[] | { [key: string]: JsonValue };
export type AuditPayload = { timestamp: string; kind: string; data: JsonValue };
export type AuditEntry = AuditPayload & { id: number; prevHash: string; hash: string };
export type VerificationResult = { valid: true; count: number } | { valid: false; count: number; error: string };

const GENESIS_HASH = "0".repeat(64);

export function canonicalJson(value: JsonValue): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`).join(",")}}`;
}

function entryHash(prevHash: string, payloadJson: string): string {
  return createHash("sha256").update(prevHash).update(payloadJson).digest("hex");
}

type Row = { id: number; timestamp: string; kind: string; data_json: string; prev_hash: string; hash: string };

export class AuditLog {
  private readonly db: Database.Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        kind TEXT NOT NULL,
        data_json TEXT NOT NULL,
        prev_hash TEXT NOT NULL CHECK(length(prev_hash) = 64),
        hash TEXT NOT NULL UNIQUE CHECK(length(hash) = 64)
      );
      CREATE TRIGGER IF NOT EXISTS audit_entries_no_update
      BEFORE UPDATE ON audit_entries BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS audit_entries_no_delete
      BEFORE DELETE ON audit_entries BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
    `);
  }

  append(payload: AuditPayload): AuditEntry {
    const transaction = this.db.transaction((value: AuditPayload) => {
      const previous = this.db.prepare("SELECT hash FROM audit_entries ORDER BY id DESC LIMIT 1").get() as { hash: string } | undefined;
      const prevHash = previous?.hash ?? GENESIS_HASH;
      const payloadJson = canonicalJson(value);
      const hash = entryHash(prevHash, payloadJson);
      const result = this.db.prepare(
        "INSERT INTO audit_entries(timestamp, kind, data_json, prev_hash, hash) VALUES (?, ?, ?, ?, ?)",
      ).run(value.timestamp, value.kind, canonicalJson(value.data), prevHash, hash);
      return { ...value, id: Number(result.lastInsertRowid), prevHash, hash };
    });
    return transaction(payload);
  }

  list(): AuditEntry[] {
    return (this.db.prepare("SELECT * FROM audit_entries ORDER BY id").all() as Row[]).map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      kind: row.kind,
      data: JSON.parse(row.data_json) as JsonValue,
      prevHash: row.prev_hash,
      hash: row.hash,
    }));
  }

  verify(): VerificationResult {
    const rows = this.db.prepare("SELECT * FROM audit_entries ORDER BY id").all() as Row[];
    let expectedPrev = GENESIS_HASH;
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]!;
      const payloadJson = canonicalJson({ timestamp: row.timestamp, kind: row.kind, data: JSON.parse(row.data_json) as JsonValue });
      if (row.prev_hash !== expectedPrev) return { valid: false, count: index, error: `broken prevHash at entry ${row.id}` };
      if (row.hash !== entryHash(expectedPrev, payloadJson)) return { valid: false, count: index, error: `invalid hash at entry ${row.id}` };
      expectedPrev = row.hash;
    }
    return { valid: true, count: rows.length };
  }

  close(): void {
    this.db.close();
  }
}
