import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { slugify } from '../core/ids.js';

const DATA_DIR = join(process.cwd(), 'data');
const DB_PATH = join(DATA_DIR, 'db.sqlite');

let db;
let savepointCounter = 0;

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

function migrate(database) {
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
