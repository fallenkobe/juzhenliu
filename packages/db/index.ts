import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { publishingSchema } from './publishing-schema';
import { oauthSchema } from './oauth-schema';
import { videoSchema } from './video-schema';
import { accountSchema } from './account-schema';
import { worksSchema } from './works-schema';
import { videoSnapshotSchema } from './video-snapshot-schema';
import { snapshotFromReport } from '../video/snapshots';
import { root, dataDir } from '../config/env';

export { root, dataDir };

export type Row = Record<string, any>;
export interface Query { <T = Row>(sql: string, params?: (string | number | null)[]): Promise<T[]> }
export interface Client { query: Query }
export const storageMode = process.env.DATABASE_URL ? 'PostgreSQL' : 'SQLite';

const schema = `
CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workspaces (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, account_limit INTEGER NOT NULL,
 daily_budget_cents INTEGER NOT NULL, outstanding_budget_cents INTEGER NOT NULL,
 per_order_cents INTEGER NOT NULL, per_batch_cents INTEGER NOT NULL,
 budget_version INTEGER NOT NULL DEFAULT 1, timezone TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), role TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS accounts (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), nickname TEXT NOT NULL,
 handle TEXT NOT NULL, account_group TEXT NOT NULL, color TEXT NOT NULL, status TEXT NOT NULL,
 auth_epoch INTEGER NOT NULL DEFAULT 1, followers INTEGER NOT NULL, likes INTEGER NOT NULL,
 posts INTEGER NOT NULL, synced_at TEXT NOT NULL, provider TEXT NOT NULL,
 UNIQUE(workspace_id, handle), UNIQUE(workspace_id, id)
);
CREATE TABLE IF NOT EXISTS assets (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), title TEXT NOT NULL,
 theme TEXT NOT NULL, filename TEXT, mime TEXT, bytes INTEGER NOT NULL DEFAULT 0,
 storage_key TEXT, content_hash TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS previews (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), kind TEXT NOT NULL,
 payload TEXT NOT NULL, fingerprint TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS publish_batches (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), request_key TEXT NOT NULL,
 fingerprint TEXT NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(workspace_id, request_key), UNIQUE(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS publish_jobs (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, batch_id TEXT NOT NULL, account_id TEXT NOT NULL,
 asset_id TEXT NOT NULL, title TEXT NOT NULL, auth_epoch INTEGER NOT NULL, state TEXT NOT NULL,
 scenario TEXT NOT NULL, external_id TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(workspace_id,batch_id) REFERENCES publish_batches(workspace_id,id),
 FOREIGN KEY(workspace_id,account_id) REFERENCES accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,asset_id) REFERENCES assets(workspace_id,id),
 UNIQUE(workspace_id,account_id,asset_id), UNIQUE(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS works (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, account_id TEXT NOT NULL, asset_id TEXT NOT NULL,
 title TEXT NOT NULL, visibility TEXT NOT NULL, external_id TEXT NOT NULL,
 plays INTEGER NOT NULL DEFAULT 0, likes INTEGER NOT NULL DEFAULT 0, comments INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, UNIQUE(workspace_id,id),
 FOREIGN KEY(workspace_id,account_id) REFERENCES accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,asset_id) REFERENCES assets(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS promotion_batches (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), request_key TEXT NOT NULL,
 fingerprint TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(workspace_id,request_key), UNIQUE(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS promotion_orders (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, batch_id TEXT NOT NULL, work_id TEXT NOT NULL,
 account_id TEXT NOT NULL, auth_epoch INTEGER NOT NULL, budget_cents INTEGER NOT NULL CHECK(budget_cents>0),
 confirmation_day TEXT NOT NULL, goal TEXT NOT NULL, hours INTEGER NOT NULL,
 create_state TEXT NOT NULL, payment_state TEXT NOT NULL, delivery_state TEXT NOT NULL,
 actual_cents INTEGER CHECK(actual_cents>=0), external_id TEXT, scenario TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(workspace_id,batch_id) REFERENCES promotion_batches(workspace_id,id),
 FOREIGN KEY(workspace_id,work_id) REFERENCES works(workspace_id,id),
 FOREIGN KEY(workspace_id,account_id) REFERENCES accounts(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS metric_points (
 workspace_id TEXT NOT NULL, account_id TEXT NOT NULL, day TEXT NOT NULL,
 plays INTEGER NOT NULL, followers INTEGER NOT NULL, likes INTEGER NOT NULL,
 PRIMARY KEY(workspace_id,account_id,day), FOREIGN KEY(workspace_id,account_id) REFERENCES accounts(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), action TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS worker_heartbeat (id TEXT PRIMARY KEY, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS publish_queue_idx ON publish_jobs(state,updated_at);
CREATE INDEX IF NOT EXISTS promotion_queue_idx ON promotion_orders(delivery_state,updated_at);
CREATE INDEX IF NOT EXISTS audit_workspace_idx ON audit_events(workspace_id,created_at);
`;

export class Database implements Client {
  private sqlite?: DatabaseSync;
  private pool?: Pool;
  private queue = Promise.resolve();
  constructor() {
    if (process.env.DATABASE_URL) this.pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
    else {
      mkdirSync(dataDir, { recursive: true });
      this.sqlite = new DatabaseSync(path.join(dataDir, 'alpha.sqlite'));
      this.sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    }
  }
  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const before = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>(r => { release = r; });
    await before;
    try { return await fn(); } finally { release(); }
  }
  private sqlQuery: Query = async <T>(sql: string, params: (string | number | null)[] = []) => {
    const ordered: (string | number | null)[] = [];
    const source = sql.replace(/\$(\d+)/g, (_, n) => { ordered.push(params[Number(n) - 1]); return '?'; });
    return this.sqlite!.prepare(source).all(...ordered) as T[];
  };
  query: Query = async <T>(sql: string, params: (string | number | null)[] = []) => {
    if (this.pool) return (await this.pool.query(sql, params)).rows as T[];
    return this.exclusive(() => this.sqlQuery<T>(sql, params));
  };
  async transaction<T>(workspaceId: string | null, fn: (tx: Client) => Promise<T>): Promise<T> {
    if (this.pool) {
      const client: PoolClient = await this.pool.connect();
      try {
        await client.query('BEGIN');
        if (workspaceId) await client.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [workspaceId]);
        const result = await fn({ query: async <R>(sql: string, params?: (string | number | null)[]) => (await client.query(sql, params)).rows as R[] });
        await client.query('COMMIT');
        return result;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    }
    return this.exclusive(async () => {
      this.sqlite!.exec('BEGIN IMMEDIATE');
      try { const result = await fn({ query: this.sqlQuery }); this.sqlite!.exec('COMMIT'); return result; }
      catch (error) { this.sqlite!.exec('ROLLBACK'); throw error; }
    });
  }
  async migrate() {
    // One initial, idempotent migration; later changes need new numbered files.
    if (this.pool) {
      const c = await this.pool.connect();
      try { await c.query('BEGIN'); await c.query("SELECT pg_advisory_xact_lock(91001001)"); await c.query(schema); await c.query("INSERT INTO schema_migrations VALUES('001_alpha', $1) ON CONFLICT DO NOTHING", [new Date().toISOString()]); await c.query('COMMIT'); }
      catch (error) { await c.query('ROLLBACK'); throw error; } finally { c.release(); }
    } else await this.exclusive(async () => { this.sqlite!.exec('BEGIN IMMEDIATE'); try { this.sqlite!.exec(schema); await this.sqlQuery("INSERT INTO schema_migrations VALUES('001_alpha',$1) ON CONFLICT DO NOTHING", [new Date().toISOString()]); this.sqlite!.exec('COMMIT'); } catch (e) { this.sqlite!.exec('ROLLBACK'); throw e; } });
    await this.transaction(null, async tx => {
      if(this.pool) await tx.query('SELECT pg_advisory_xact_lock(91001002)');
      for(const statement of oauthSchema.split(';').filter(s=>s.trim())) await tx.query(statement);
      await tx.query("INSERT INTO schema_migrations VALUES('002_douyin_oauth',$1) ON CONFLICT DO NOTHING", [new Date().toISOString()]);
    });
    await this.transaction(null, async tx => {
      if(this.pool) await tx.query('SELECT pg_advisory_xact_lock(91001003)');
      for(const statement of videoSchema.split(';').filter(s=>s.trim())) await tx.query(statement);
      await tx.query("INSERT INTO schema_migrations VALUES('003_video_analytics',$1) ON CONFLICT DO NOTHING", [new Date().toISOString()]);
    });
    await this.transaction(null, async tx => {
      if(this.pool) await tx.query('SELECT pg_advisory_xact_lock(91001004)');
      for(const statement of accountSchema.split(';').filter(s=>s.trim())) await tx.query(statement);
      await tx.query("INSERT INTO schema_migrations VALUES('004_managed_accounts',$1) ON CONFLICT DO NOTHING", [new Date().toISOString()]);
    });
    await this.transaction(null, async tx => {
      if(this.pool) await tx.query('SELECT pg_advisory_xact_lock(91001005)');
      for(const statement of worksSchema.split(';').filter(s=>s.trim())) await tx.query(statement);
      await tx.query("INSERT INTO schema_migrations VALUES('005_account_works',$1) ON CONFLICT DO NOTHING", [new Date().toISOString()]);
    });
    await this.transaction(null, async tx => {
      if(this.pool) await tx.query('SELECT pg_advisory_xact_lock(91001006)');
      const applied = await tx.query("SELECT version FROM schema_migrations WHERE version='006_video_query_snapshots'");
      if (applied.length) return;
      for(const statement of videoSnapshotSchema.split(';').filter(s=>s.trim())) await tx.query(statement);
      // Only the last retained report can be recovered; keep its actual query time.
      const reports = await tx.query('SELECT video_id,report_json FROM video_reports');
      for (const row of reports) {
        const snapshot = snapshotFromReport(JSON.parse(row.report_json), 'saved-report');
        if (snapshot) await tx.query('INSERT INTO video_query_snapshots VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
          [row.video_id, snapshot.fetchedAt, JSON.stringify(snapshot)]);
      }
      await tx.query("INSERT INTO schema_migrations VALUES('006_video_query_snapshots',$1)", [new Date().toISOString()]);
    });
    await this.transaction(null, async tx => {
      if(this.pool) await tx.query('SELECT pg_advisory_xact_lock(91001007)');
      for(const statement of publishingSchema.split(';').filter(s=>s.trim())) await tx.query(statement);
      await tx.query("INSERT INTO schema_migrations VALUES('007_publishing',$1) ON CONFLICT DO NOTHING", [new Date().toISOString()]);
    });
  }
  async close() { if (this.pool) await this.pool.end(); else this.sqlite?.close(); }
}
const globalDb = globalThis as typeof globalThis & { matrixDb?: Database; matrixReady?: Promise<void> };
export const db = globalDb.matrixDb ??= new Database();
export function onceReady(fn: () => Promise<void>) { return globalDb.matrixReady ??= fn(); }
