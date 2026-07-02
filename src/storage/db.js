import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { slugify } from '../core/ids.js';

const DATA_DIR = join(process.cwd(), 'data');
const DB_PATH = join(DATA_DIR, 'db.sqlite');

let db;
let savepointCounter = 0;

/**
 * ─── Supabase Storage backup (server persistence) ───
 *
 * On Render (free tier) or any server with ephemeral storage, the SQLite
 * database is lost on every redeploy.  When the environment variables below
 * are set, this module syncs the .sqlite file to Supabase Storage so apps,
 * records, and settings survive redeploys.
 *
 * Locally (no env vars), everything works with the local SQLite file —
 * Supabase is never touched.
 *
 * Required env vars (set in Render Dashboard → Environment):
 *   SUPABASE_URL          https://xxxxx.supabase.co
 *   SUPABASE_SERVICE_KEY  Service role key (Settings → API → service_role key)
 *   SUPABASE_BUCKET       Bucket name (default: luban-data)
 *
 * To set up:
 *   1. Create a free Supabase account + project
 *   2. In Supabase Dashboard → Storage → Create a bucket named "luban-data"
 *   3. In Supabase Dashboard → Settings → API → copy the project URL & service_role key
 *   4. Set the three environment variables above in Render Dashboard
 *   5. Redeploy — your data will now persist across deploys
 */

function supabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  const bucket = process.env.SUPABASE_BUCKET || 'luban-data';
  const baseUrl = url.replace(/\/$/, '');
  const objectPath = `${baseUrl}/storage/v1/object/${bucket}/db.sqlite`;
  console.log(`[db] Supabase 已配置 — ${baseUrl}/storage/v1/object/${bucket}/db.sqlite`);
  return {
    downloadUrl: objectPath,
    uploadUrl: objectPath,
    key
  };
}

async function downloadFromSupabase(cfg) {
  try {
    const res = await fetch(cfg.downloadUrl, {
      headers: { authorization: `Bearer ${cfg.key}` }
    });
    if (res.status === 404) {
      console.log('[db] 未找到远程备份，将创建新数据库。');
      return;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '(unable to read body)');
      // Supabase returns HTTP 400 with body {"statusCode":"404","error":"not_found","message":"Object not found"}
      // when the backup file doesn't exist yet (first deploy). Treat it like 404.
      const isNotFound = res.status === 404 || body.includes('"statusCode":"404"') || body.includes('"error":"not_found"') || body.includes('Object not found');
      if (isNotFound) {
        console.log('[db] 未找到远程备份，将创建新数据库。');
        return;
      }
      console.error(`[db] 从 Supabase 下载失败：${res.status} — ${body}`);
      return;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    writeFileSync(DB_PATH, buffer);
    console.log(`[db] 已从 Supabase 恢复数据库 (${(buffer.length / 1024).toFixed(1)} KB)`);
  } catch (err) {
    console.error('[db] 从 Supabase 下载出错：', err.message);
  }
}

async function uploadToSupabase(cfg) {
  try {
    // Flush WAL to the main DB file so the snapshot is consistent。
    // 使用 RESTART 模式等待活跃读者完成，最多重试 3 次。
    // 避免 TRUNCATE 在有并发读取时静默失败，导致备份遗漏 WAL 中的最新数据。
    let checkpointOk = false;
    const db = getDb();
    for (let attempt = 0; attempt < 3; attempt++) {
      const row = db.prepare('PRAGMA wal_checkpoint(RESTART)').get();
      // 返回格式：{ busy, pagecount, checkpoint }，checkpoint 为 0 表示成功
      if (row && (row.checkpoint === 0 || row.checkpoint === 1)) {
        checkpointOk = true;
        break;
      }
      // 等待活跃读者完成后再试
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
    if (!checkpointOk) {
      // 最终保底：PASSIVE 模式至少部分刷新
      db.prepare('PRAGMA wal_checkpoint(PASSIVE)').get();
    }
    const buffer = readFileSync(DB_PATH);
    const res = await fetch(cfg.uploadUrl, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${cfg.key}`,
        'content-type': 'application/octet-stream'
      },
      body: buffer
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '(unable to read body)');
      console.error(`[db] 上传到 Supabase 失败：${res.status} — ${body}`);
      return;
    }
    console.log(`[db] 已备份数据库到 Supabase (${(buffer.length / 1024).toFixed(1)} KB)`);
  } catch (err) {
    console.error('[db] 上传到 Supabase 出错：', err.message);
  }
}

let backupTimer = null;

function startBackupTimer(cfg) {
  if (backupTimer) return;
  // Upload the DB file every 1 hour if Supabase is configured.
  // Uses .unref() so the timer does not prevent the process from exiting.
  backupTimer = setInterval(async () => {
    await uploadToSupabase(cfg);
  }, 3_600_000).unref();
}

function stopBackupTimer() {
  if (backupTimer) {
    clearInterval(backupTimer);
    backupTimer = null;
  }
}

/**
 * Initialize the database asynchronously.
 * - On Render: downloads the SQLite file from Supabase Storage if available
 * - Opens the database and runs pending migrations
 * - Starts the periodic backup timer (if Supabase is configured)
 *
 * Call this once at server startup (server.js) before handling requests.
 * getDb() remains synchronous for existing code — it lazy-initialises with a
 * fresh local database, so it's safe to call before initDb() in tests or dev.
 */
let initialized = false;

export async function initDb() {
  if (initialized) return;
  initialized = true;

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  // If Supabase is configured and there's no local file yet, restore from backup
  const cfg = supabaseConfig();
  if (cfg && !existsSync(DB_PATH)) {
    await downloadFromSupabase(cfg);
  }

  if (!db) {
    db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    migrate(db);
  }

  if (cfg) {
    // 启动后立即备份一次，确保文件立即可见
    await uploadToSupabase(cfg);
    // 之后每 1 小时自动备份
    startBackupTimer(cfg);
  }
}

export function getDb() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!db) {
    db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    migrate(db);
  }
  return db;
}

let pendingUpload = null; // tracks in-flight upload promise

/**
 * Upload the database to Supabase immediately and stop the backup timer.
 * Called during graceful shutdown so the latest data is persisted before exit.
 */
export async function closeDb() {
  stopBackupTimer();
  const cfg = supabaseConfig();
  if (cfg) {
    // Wait for any in-flight triggerBackup to finish before doing final upload
    if (pendingUpload) await pendingUpload;
    await uploadToSupabase(cfg);
  }
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Trigger an immediate backup to Supabase.
 * Used after data-changing operations like app creation or record mutations.
 * Errors are logged to console.error — never silently swallowed.
 * closeDb() awaits any pending upload before shutdown.
 */
export function triggerBackup() {
  const cfg = supabaseConfig();
  if (!cfg) return;
  const run = uploadToSupabase(cfg);
  pendingUpload = run;
  run.catch((err) => {
    console.error('[db] 备份到 Supabase 失败：', err.message);
    if (pendingUpload === run) pendingUpload = null;
  });
  run.then(() => {
    if (pendingUpload === run) pendingUpload = null;
  });
}

export function resetDbForTests(path) {
  if (db) db.close();
  mkdirSync(dirname(path), { recursive: true });
  db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

export function withTransaction(callback) {
  const database = getDb();
  const savepoint = `sp_${++savepointCounter}`;
  database.exec(`SAVEPOINT ${savepoint}`);
  try {
    const result = callback(database);
    database.exec(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (error) {
    database.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    database.exec(`RELEASE SAVEPOINT ${savepoint}`);
    throw error;
  }
}

const SCHEMA_VERSION = 6;

/*
 * Migration strategy:
 * - Each version adds its delta on top of the previous one
 * - SCHEMA_VERSION tracks the latest version the code knows about
 * - PRAGMA user_version stores the actual schema version on disk
 * - When user_version < SCHEMA_VERSION, unapplied migrations run in order
 * - Rolling back code does NOT revert schema — downgrade migrations are manual
 */
function migrate(database) {
  const currentVersion = Number(database.prepare('PRAGMA user_version').get()?.user_version || 0);

  if (currentVersion < 1) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS apps (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        icon TEXT,
        manifestJson TEXT NOT NULL,
        schemaJson TEXT NOT NULL,
        uiJson TEXT NOT NULL,
        actionsJson TEXT NOT NULL,
        promptsJson TEXT,
        version TEXT NOT NULL DEFAULT '1.0.0',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS records (
        id TEXT PRIMARY KEY,
        appId TEXT NOT NULL,
        entityId TEXT NOT NULL,
        dataJson TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (appId) REFERENCES apps(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS record_relations (
        id TEXT PRIMARY KEY,
        appId TEXT NOT NULL,
        sourceEntityId TEXT NOT NULL,
        sourceRecordId TEXT NOT NULL,
        fieldId TEXT NOT NULL,
        targetEntityId TEXT NOT NULL,
        targetRecordId TEXT NOT NULL,
        sortOrder INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL,
        UNIQUE(sourceRecordId, fieldId, targetRecordId),
        FOREIGN KEY (appId) REFERENCES apps(id) ON DELETE CASCADE,
        FOREIGN KEY (sourceRecordId) REFERENCES records(id) ON DELETE CASCADE,
        FOREIGN KEY (targetRecordId) REFERENCES records(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_records_app_entity_created ON records(appId, entityId, createdAt);

      CREATE INDEX IF NOT EXISTS idx_record_relations_source ON record_relations(sourceRecordId, fieldId);
      CREATE INDEX IF NOT EXISTS idx_record_relations_target ON record_relations(targetRecordId);
      CREATE INDEX IF NOT EXISTS idx_record_relations_app ON record_relations(appId);

      CREATE TABLE IF NOT EXISTS ai_sessions (
        id TEXT PRIMARY KEY,
        appId TEXT,
        status TEXT NOT NULL DEFAULT 'idle',
        currentPlanJson TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (appId) REFERENCES apps(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS ai_messages (
        id TEXT PRIMARY KEY,
        sessionId TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT,
        structuredContentJson TEXT,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (sessionId) REFERENCES ai_sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_ai_messages_session ON ai_messages(sessionId);

      CREATE TABLE IF NOT EXISTS ai_execution_logs (
        id TEXT PRIMARY KEY,
        sessionId TEXT NOT NULL,
        stepName TEXT NOT NULL,
        toolName TEXT,
        status TEXT NOT NULL,
        inputJson TEXT,
        outputJson TEXT,
        error TEXT,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (sessionId) REFERENCES ai_sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_ai_logs_session ON ai_execution_logs(sessionId);

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        valueJson TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
    `);
  }

  if (currentVersion < 2) {
    // Add type column to ai_sessions to distinguish create vs modify sessions
    try {
      database.exec(`ALTER TABLE ai_sessions ADD COLUMN type TEXT NOT NULL DEFAULT 'create'`);
    } catch {
      // Column may already exist on re-run; ignore
    }
  }

  if (currentVersion < 3) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS rule_runs (
        id TEXT PRIMARY KEY,
        appId TEXT NOT NULL,
        ruleId TEXT NOT NULL,
        sourceEntity TEXT NOT NULL,
        sourceRecordId TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('success', 'blocked', 'failed', 'skipped')),
        stepsJson TEXT NOT NULL,
        inputSnapshotJson TEXT,
        outputSnapshotJson TEXT,
        errorMessage TEXT,
        idempotencyKey TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (appId) REFERENCES apps(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_rule_runs_app_created ON rule_runs(appId, createdAt DESC);
      CREATE INDEX IF NOT EXISTS idx_rule_runs_rule_created ON rule_runs(ruleId, createdAt DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_rule_runs_success_idempotency
        ON rule_runs(appId, idempotencyKey) WHERE status = 'success';
    `);
  }

  if (currentVersion < 4) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS rules (
        id TEXT PRIMARY KEY,
        appId TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL CHECK(status IN ('draft', 'active', 'disabled')),
        sourceText TEXT NOT NULL,
        businessIntentJson TEXT NOT NULL,
        schemaMappingJson TEXT NOT NULL,
        contractJson TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (appId) REFERENCES apps(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_rules_app_updated ON rules(appId, updatedAt DESC);
      CREATE INDEX IF NOT EXISTS idx_rules_app_status ON rules(appId, status);
    `);
  }

  if (currentVersion < 5) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS rule_record_states (
        appId TEXT NOT NULL,
        ruleId TEXT NOT NULL,
        sourceEntity TEXT NOT NULL,
        sourceRecordId TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('waiting', 'success')),
        missingFieldsJson TEXT NOT NULL DEFAULT '[]',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        PRIMARY KEY (appId, ruleId, sourceRecordId),
        FOREIGN KEY (appId) REFERENCES apps(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_rule_record_states_rule_state
        ON rule_record_states(appId, ruleId, state, updatedAt DESC);
      CREATE INDEX IF NOT EXISTS idx_rule_record_states_record
        ON rule_record_states(appId, sourceRecordId, state);
    `);
  }

  if (currentVersion < 6) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS auto_number_sequences (
        appId TEXT NOT NULL,
        entityId TEXT NOT NULL,
        fieldId TEXT NOT NULL,
        nextValue INTEGER NOT NULL,
        PRIMARY KEY (appId, entityId, fieldId),
        FOREIGN KEY (appId) REFERENCES apps(id) ON DELETE CASCADE
      );
    `);
  }

  if (currentVersion < SCHEMA_VERSION) {
    database.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }

  // Recover orphaned pending confirmations — after a server restart the SSE
  // connection that was awaiting user confirmation is gone, so mark them as failed.
  const pendingStmt = database.prepare(
    "SELECT id, sessionId, stepName FROM ai_execution_logs WHERE status = 'pending_confirmation'"
  );
  const failStmt = database.prepare(
    "UPDATE ai_execution_logs SET status = 'failed', error = ? WHERE id = ?"
  );
  const orphans = pendingStmt.all();
  for (const row of orphans) {
    failStmt.run('Server restarted — pending confirmation expired.', row.id);
  }
}

function now() {
  return new Date().toISOString();
}

export function rowToApp(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    icon: row.icon,
    manifest: JSON.parse(row.manifestJson),
    schema: JSON.parse(row.schemaJson),
    ui: JSON.parse(row.uiJson),
    actions: JSON.parse(row.actionsJson),
    prompts: row.promptsJson ? JSON.parse(row.promptsJson) : undefined,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function appToPackage(app) {
  return {
    manifest: app.manifest,
    schema: app.schema,
    ui: app.ui,
    actions: app.actions,
    prompts: app.prompts || {}
  };
}

export function getPackageFromApp(app) {
  return structuredClone(appToPackage(app));
}
