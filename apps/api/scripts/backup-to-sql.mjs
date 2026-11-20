#!/usr/bin/env node
// Turn an AffiliateOS R2 backup (affiliateos-*.json.gz) into SQL that restores every table.
// Usage: node scripts/backup-to-sql.mjs backup.json.gz > restore.sql
//        wrangler d1 execute affiliateos --remote --file restore.sql   (after reviewing it!)
// The target database must already have the same migrations applied (listed in the backup).
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const ORDER = ["products", "collections", "collection_products", "automations", "instagram_accounts", "webhook_events", "dm_jobs", "dm_attempts", "click_events", "collection_views", "data_deletion_requests", "app_logs", "system_state"];

export function backupToSql(backup) {
  if (backup?.format !== "affiliateos-backup" || backup.version !== 1) throw new Error("Not an AffiliateOS backup (format/version mismatch)");
  const lit = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? (Number.isFinite(v) ? String(v) : "NULL") : typeof v === "boolean" ? (v ? "1" : "0") : `'${String(v).replace(/'/g, "''")}'`);
  const out = [`-- AffiliateOS restore from backup created ${backup.createdAt}`, `-- Requires migrations: ${backup.migrations.join(", ")}`, "PRAGMA defer_foreign_keys = true;"];
  for (const t of [...ORDER].reverse()) out.push(`DELETE FROM ${t};`);
  for (const t of ORDER) {
    for (const row of backup.tables[t] ?? []) {
      const cols = Object.keys(row);
      out.push(`INSERT INTO ${t} (${cols.join(", ")}) VALUES (${cols.map((c) => lit(row[c])).join(", ")});`);
    }
  }
  return out.join("\n") + "\n";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (!file) { console.error("usage: backup-to-sql.mjs <backup.json.gz>"); process.exit(2); }
  const raw = readFileSync(file);
  const json = JSON.parse((file.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8"));
  process.stdout.write(backupToSql(json));
}
