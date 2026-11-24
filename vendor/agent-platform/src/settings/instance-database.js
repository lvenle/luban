import { existsSync, renameSync, chmodSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * 实例级共享 SQLite 的文件名。它同时承载会话/运行记录、计划本与知识库元数据，
 * 所以用中性的 instance.sqlite，而不是只反映运行记录的 runs.sqlite。
 */
export const INSTANCE_DB_FILENAME = 'instance.sqlite';
/** 旧文件名：早期版本把同一个共享库叫 runs.sqlite。 */
export const LEGACY_DB_FILENAME = 'runs.sqlite';

/**
 * 打开实例级 SQLite，并设置 P0 所需的 PRAGMA。
 *
 * - journal_mode = WAL：减少高频写入的 fsync 与锁竞争。开启后会出现 -wal / -shm 附属文件；
 *   改名前先恢复并 checkpoint 旧库 WAL，不直接移动活跃的附属文件。
 * - synchronous = NORMAL：WAL 下推荐选择，性能与安全的折中。
 * - auto_vacuum = INCREMENTAL：删行后由 incremental_vacuum 逐步回收页面。
 *   注意：从 NONE 切到 INCREMENTAL 需要一次 VACUUM 才能生效（旧库的 freelist 必须重建）。
 *
 * 返回 { db, autoVacuumJustEnabled, schemaInfo }。
 * - autoVacuumJustEnabled=true：本次刚把 auto_vacuum 从 NONE 切到 INCREMENTAL，
 *   调用方应随后做一次 VACUUM 让旧库生效，并更新 schema_migrations 记录。
 */
/**
 * 实例级共享库的 DDL：在 openInstanceDatabase 之后由调用方执行一次。
 * 把所有共享表集中到这里，避免运行态组件各自维护自己的 DDL 切片。
 */
export function applyInstanceSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, owner TEXT NOT NULL, agent TEXT NOT NULL, title TEXT, deleted INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS product_sessions(
      product_id TEXT NOT NULL,
      owner TEXT NOT NULL,
      external_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id),
      created_at TEXT NOT NULL,
      PRIMARY KEY(product_id,owner,external_id,agent_id)
    );
    CREATE TABLE IF NOT EXISTS run_events(run_id TEXT, sequence INTEGER, event TEXT, PRIMARY KEY(run_id, sequence));
    CREATE TABLE IF NOT EXISTS run_late_events(run_id TEXT, sequence INTEGER, event TEXT, PRIMARY KEY(run_id, sequence));
    CREATE TABLE IF NOT EXISTS run_owners(run_id TEXT PRIMARY KEY, owner TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS config_revisions(
      revision INTEGER PRIMARY KEY,
      snapshot TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    -- P3：合库事务性
    CREATE TABLE IF NOT EXISTS model_diagnostics(
      connection_id     TEXT NOT NULL,
      model_id          TEXT NOT NULL DEFAULT '',
      health            TEXT,
      health_checked_at TEXT,
      failure_count     INTEGER NOT NULL DEFAULT 0,
      card              TEXT,
      updated_at        TEXT NOT NULL,
      PRIMARY KEY(connection_id, model_id)
    );
    CREATE TABLE IF NOT EXISTS conversations(
      channel         TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      session_id      TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      last_reply_at   TEXT,
      pending         TEXT,
      updated_at      TEXT NOT NULL,
      PRIMARY KEY(channel, conversation_id)
    );
    -- P4：wechat 事件与会话派发状态。events 不可变；dispatch 跟随回复落地而变化。
    CREATE TABLE IF NOT EXISTS wechat_events(
      event_id        TEXT PRIMARY KEY,
      account_id      TEXT,
      conversation_id TEXT,
      sender_name     TEXT,
      direction       TEXT,
      is_self         INTEGER NOT NULL DEFAULT 0,
      message_type    TEXT,
      text            TEXT,
      attachments     TEXT,
      raw             TEXT,
      occurred_at     INTEGER NOT NULL,
      recorded_at     TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wechat_events_time ON wechat_events(occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_wechat_events_conv ON wechat_events(conversation_id, occurred_at DESC);
    CREATE TABLE IF NOT EXISTS wechat_dispatch(
      event_id        TEXT PRIMARY KEY REFERENCES wechat_events(event_id),
      allowed         INTEGER,
      reason          TEXT,
      batch_id        TEXT,
      dispatch_status TEXT,
      reply_content   TEXT,
      replied_at      TEXT,
      reply_reason    TEXT,
      carried_forward INTEGER NOT NULL DEFAULT 0,
      updated_at      TEXT NOT NULL
    );
    -- P4：调度审计事件（区别于 run_events：包括 skill_run_completed / schedule_run_link 等子事件）。
    CREATE TABLE IF NOT EXISTS schedule_audit_events(
      event_id TEXT PRIMARY KEY,
      schedule_id TEXT,
      run_id TEXT,
      type TEXT NOT NULL,
      payload TEXT,
      recorded_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_schedule_audit_schedule_time ON schedule_audit_events(schedule_id, recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_schedule_audit_time ON schedule_audit_events(recorded_at DESC);
    -- P4：定时任务定义（1:1 调度状态同表）。执行记录进 runs（1:N）。
    CREATE TABLE IF NOT EXISTS schedules(
      id                TEXT PRIMARY KEY,
      product_id        TEXT,
      name              TEXT,
      description       TEXT,
      enabled           INTEGER NOT NULL DEFAULT 1,
      trigger           TEXT,
      target            TEXT,
      execution         TEXT,
      policy            TEXT,
      ui                TEXT,
      last_started_at   TEXT,
      last_completed_at TEXT,
      last_run          TEXT,
      next_run_at       TEXT,
      retry_count       INTEGER NOT NULL DEFAULT 0,
      last_skip_reason  TEXT,
      last_skipped_at   TEXT,
      created_at        TEXT,
      updated_at        TEXT
    );
    -- P4：统一运行记录。状态物化（与 run_events 双源，靠同事务写 + 启动对账收敛）。
    -- owner 取代 run_owners。
    CREATE TABLE IF NOT EXISTS runs(
      run_id        TEXT PRIMARY KEY,
      source        TEXT NOT NULL,
      owner         TEXT NOT NULL,
      agent_id      TEXT,
      agent_version TEXT,
      session_id    TEXT,
      schedule_id   TEXT,
      model         TEXT,
      status        TEXT NOT NULL,
      error         TEXT,
      started_at    TEXT NOT NULL,
      finished_at   TEXT
    );
    CREATE TABLE IF NOT EXISTS run_requests(
      product_id TEXT NOT NULL,
      owner TEXT NOT NULL,
      request_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      run_id TEXT NOT NULL UNIQUE REFERENCES runs(run_id),
      created_at TEXT NOT NULL,
      PRIMARY KEY(product_id,owner,request_id)
    );
    CREATE INDEX IF NOT EXISTS idx_runs_owner_time    ON runs(owner, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_runs_source_time   ON runs(source, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_runs_status_time   ON runs(status, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_runs_session       ON runs(session_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_runs_schedule      ON runs(schedule_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_config_revisions_created
      ON config_revisions(created_at DESC);
    -- 微信知识库来源配置（v1.3）：
    -- - kind: wechat_chat（按 conversation_id 匹配 wechat_events）
    --        wechat_favorite（收藏库，单独 reader 通道；conversation_id 留空）
    -- - system: 1 表示内置来源（filehelper / 收藏），不允许 delete，只能改 enabled
    -- - media_types: JSON 字符串数组；空数组 = 不过滤
    CREATE TABLE IF NOT EXISTS kb_sources(
      id              TEXT PRIMARY KEY,
      kind            TEXT NOT NULL,
      conversation_id TEXT,
      alias           TEXT NOT NULL,
      enabled         INTEGER NOT NULL DEFAULT 1,
      direction       TEXT,
      media_types     TEXT,
      notes           TEXT,
      system          INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_kb_sources_kind_conv
      ON kb_sources(kind, conversation_id);
    CREATE INDEX IF NOT EXISTS idx_kb_sources_enabled
      ON kb_sources(enabled);`);
  const eventCols = new Set(db.prepare('PRAGMA table_info(wechat_events)').all().map(c => c.name));
  if (!eventCols.has('event_json')) db.exec('ALTER TABLE wechat_events ADD COLUMN event_json TEXT');
  const scheduleCols = new Set(db.prepare('PRAGMA table_info(schedules)').all().map(c => c.name));
  if (!scheduleCols.has('definition')) db.exec('ALTER TABLE schedules ADD COLUMN definition TEXT');
  const runCols = new Set(db.prepare('PRAGMA table_info(runs)').all().map(c => c.name));
  if (!runCols.has('parent_run_id')) db.exec('ALTER TABLE runs ADD COLUMN parent_run_id TEXT');
  db.exec(`CREATE TABLE IF NOT EXISTS run_checkpoints(run_id TEXT PRIMARY KEY,record TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS run_operations(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,tool TEXT NOT NULL,risk TEXT NOT NULL,fingerprint TEXT NOT NULL,status TEXT NOT NULL,outcome TEXT NOT NULL,record TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS run_operations_run ON run_operations(run_id);`);
  if (!runCols.has('application_instance_id')) db.exec('ALTER TABLE runs ADD COLUMN application_instance_id TEXT');
  if (!runCols.has('execution_mode')) db.exec("ALTER TABLE runs ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'real'");
  if (!runCols.has('executor_pid')) db.exec('ALTER TABLE runs ADD COLUMN executor_pid INTEGER');
  if (!runCols.has('executor_identity')) db.exec('ALTER TABLE runs ADD COLUMN executor_identity TEXT');
  if (!runCols.has('journal_path')) db.exec('ALTER TABLE runs ADD COLUMN journal_path TEXT');
  db.exec(`CREATE TABLE IF NOT EXISTS tool_invocations(
    id TEXT PRIMARY KEY, run_id TEXT NOT NULL, tool TEXT NOT NULL, source TEXT,
    status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT NOT NULL,
    duration_ms INTEGER NOT NULL, error_code TEXT, error_message TEXT,
    input_digest TEXT, output_digest TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_tool_invocations_run ON tool_invocations(run_id,started_at);
  CREATE INDEX IF NOT EXISTS idx_tool_invocations_tool ON tool_invocations(tool,started_at);
  CREATE TABLE IF NOT EXISTS mcp_tool_snapshots(sync_key TEXT PRIMARY KEY,server_id TEXT NOT NULL,record TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS mcp_diagnostics(server_id TEXT PRIMARY KEY,record TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS schema_migrations(id TEXT PRIMARY KEY,applied_at TEXT NOT NULL);`);
  const toolCols=new Set(db.prepare('PRAGMA table_info(tool_invocations)').all().map(c=>c.name));
  if(!toolCols.has('record'))db.exec('ALTER TABLE tool_invocations ADD COLUMN record TEXT');
  // 已有 sessions 表时补 4 列；会话摘要 1:1 吸收 .context-summaries/<session>.json。
  const cols = new Set(db.prepare('PRAGMA table_info(sessions)').all().map(c => c.name));
  const alters = [
    ['application_instance_id','TEXT'],
    ['title','TEXT'],
    ['deleted','INTEGER NOT NULL DEFAULT 0'],
    ['summary', 'TEXT'],
    ['summary_covered', 'INTEGER NOT NULL DEFAULT 0'],
    ['summary_fingerprint', 'TEXT'],
    ['summary_updated_at', 'TEXT']
  ];
  for (const [name, decl] of alters) {
    if (!cols.has(name)) db.exec(`ALTER TABLE sessions ADD COLUMN ${name} ${decl}`);
  }
}

/**
 * 同步打开实例级 SQLite 并设置 P0 所需的 PRAGMA。
 */
export function openInstanceDatabase(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = resolveInstanceDatabasePath(directory);
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  if(process.platform!=='win32')for(const suffix of ['', '-wal','-shm'])if(existsSync(path+suffix))chmodSync(path+suffix,0o600);
  db.exec('PRAGMA synchronous = NORMAL;');
  applyInstanceSchema(db);
  const currentAutoVacuum = db.prepare('PRAGMA auto_vacuum').get();
  const currentValue = typeof currentAutoVacuum === 'object' && currentAutoVacuum !== null ? currentAutoVacuum.auto_vacuum : currentAutoVacuum;
  let autoVacuumJustEnabled = false;
  if (Number(currentValue) !== 2 /* INCREMENTAL */) {
    db.exec('PRAGMA auto_vacuum = INCREMENTAL;');
    db.exec('VACUUM;');
    autoVacuumJustEnabled = true;
  }
  return { db, autoVacuumJustEnabled, path };
}

/**
 * 解析实例级 SQLite 路径，并把旧命名一次性迁移到新命名。
 *
 * - 新文件已存在：直接用新文件（迁移已完成或全新实例）。
 * - 新文件不存在、旧文件存在：在实例租约内恢复并 checkpoint 旧 WAL，再改名主文件。
 * - 被占用或改名失败：停止启动、保留旧文件，避免两套库分叉。
 */
export function resolveInstanceDatabasePath(directory) {
  const target = join(directory, INSTANCE_DB_FILENAME);
  const legacy = join(directory, LEGACY_DB_FILENAME);
  if (existsSync(target)) return target;
  if (!existsSync(legacy)) return target;
  // Production calls this under the instance lease. Recover an abandoned WAL
  // and checkpoint it before moving the main file, rather than partially
  // renaming a live database and leaving committed rows behind.
  const db=new DatabaseSync(legacy);
  try {
    db.exec('PRAGMA busy_timeout=5000');
    const result=db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    if(result.busy)throw Error('旧实例数据库仍被占用，请关闭旧服务后重试');
    db.exec('BEGIN EXCLUSIVE; COMMIT');
  } finally {db.close();}
  renameSync(legacy,target);
  return target;
}
