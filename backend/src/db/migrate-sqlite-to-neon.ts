import 'dotenv/config';
import path from 'path';
import SQLiteDatabase from 'better-sqlite3';
import db, { initDb } from './database';

type Row = Record<string, any>;

const SQLITE_DB_PATH = path.join(__dirname, '../../jobs.db');
const sqlite = new SQLiteDatabase(SQLITE_DB_PATH, { readonly: true });

function getAllRows(table: string): Row[] {
  return sqlite.prepare(`SELECT * FROM ${table}`).all() as Row[];
}

async function upsertById(table: string, rows: Row[]): Promise<void> {
  if (rows.length === 0) {
    console.log(`[migrate] ${table}: 0 rows (skipped)`);
    return;
  }

  const columns = Object.keys(rows[0]);
  const quotedColumns = columns.map(c => `"${c}"`).join(', ');
  const placeholders = columns.map(() => '?').join(', ');

  const updates = columns
    .filter(c => c !== 'id')
    .map(c => `"${c}" = EXCLUDED."${c}"`)
    .join(', ');

  const sql = updates.length > 0
    ? `INSERT INTO ${table} (${quotedColumns}) VALUES (${placeholders}) ON CONFLICT (id) DO UPDATE SET ${updates}`
    : `INSERT INTO ${table} (${quotedColumns}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`;

  const stmt = db.prepare(sql);

  let inserted = 0;
  for (const row of rows) {
    const values = columns.map(c => row[c]);
    await stmt.run(...values);
    inserted++;
  }

  console.log(`[migrate] ${table}: ${inserted} rows migrated`);
}

async function syncSequence(table: string): Promise<void> {
  await db.exec(`
    SELECT setval(
      pg_get_serial_sequence('${table}', 'id'),
      GREATEST(COALESCE((SELECT MAX(id) FROM ${table}), 0), 1)
    );
  `);
}

async function verifyCount(table: string): Promise<void> {
  const sqliteCount = (sqlite.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
  const pgCount = (await db.prepare(`SELECT COUNT(*)::int AS c FROM ${table}`).get() as { c: number }).c;
  console.log(`[verify] ${table}: sqlite=${sqliteCount}, neon=${pgCount}`);
}

async function main(): Promise<void> {
  console.log('[migrate] Initializing Neon schema...');
  await initDb();

  console.log(`[migrate] Reading SQLite database: ${SQLITE_DB_PATH}`);

  await upsertById('companies', getAllRows('companies'));
  await upsertById('runs', getAllRows('runs'));
  await upsertById('jobs', getAllRows('jobs'));

  // Single-row tables still use id conflict merge.
  await upsertById('user_preferences', getAllRows('user_preferences'));
  await upsertById('user_resume', getAllRows('user_resume'));

  // Optional tables may not exist in older SQLite DBs.
  try {
    await upsertById('push_subscriptions', getAllRows('push_subscriptions'));
  } catch {
    console.log('[migrate] push_subscriptions table not found in SQLite, skipping');
  }

  await syncSequence('companies');
  await syncSequence('runs');
  await syncSequence('jobs');
  await syncSequence('push_subscriptions');

  await verifyCount('companies');
  await verifyCount('runs');
  await verifyCount('jobs');
  await verifyCount('user_preferences');
  await verifyCount('user_resume');

  sqlite.close();
  console.log('[migrate] Migration completed. Keep jobs.db as backup until you verify the app end-to-end.');
}

main().catch((err) => {
  sqlite.close();
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
