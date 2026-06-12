import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createId, slugify } from './ids.js';
import { preparePackage } from './packageProtocol.js';

const DATA_DIR = join(process.cwd(), 'data');
const DB_PATH = join(DATA_DIR, 'db.sqlite');

let db;

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

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      appId TEXT,
      title TEXT,
      messagesJson TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

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

function rowToApp(row) {
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

function appToPackage(app) {
  return {
    manifest: app.manifest,
    schema: app.schema,
    ui: app.ui,
    actions: app.actions,
    prompts: app.prompts || {}
  };
}

export function getPackageFromApp(app) {
  return appToPackage(app);
}

export function uniqueSlug(baseSlug) {
  const database = getDb();
  const base = slugify(baseSlug, 'app');
  let candidate = base;
  let index = 2;
  while (database.prepare('SELECT id FROM apps WHERE slug = ?').get(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  return candidate;
}

export function createAppFromPackage(pkg, options = {}) {
  const database = getDb();
  const clean = preparePackage(pkg);
  const id = createId('app');
  const createdAt = now();
  const slug = uniqueSlug(options.slug || clean.manifest.id || clean.manifest.name);
  database.prepare(`
    INSERT INTO apps (
      id, slug, name, description, icon, manifestJson, schemaJson, uiJson,
      actionsJson, promptsJson, version, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    slug,
    clean.manifest.name,
    clean.manifest.description || '',
    clean.manifest.icon || '',
    JSON.stringify(clean.manifest),
    JSON.stringify(clean.schema),
    JSON.stringify(clean.ui),
    JSON.stringify(clean.actions),
    JSON.stringify(clean.prompts || {}),
    clean.manifest.version || '1.0.0',
    createdAt,
    createdAt
  );
  return getApp(id);
}

export function updateAppPackage(appId, pkg) {
  const database = getDb();
  const clean = preparePackage(pkg);
  const updatedAt = now();
  database.prepare(`
    UPDATE apps SET
      name = ?, description = ?, icon = ?, manifestJson = ?, schemaJson = ?,
      uiJson = ?, actionsJson = ?, promptsJson = ?, version = ?, updatedAt = ?
    WHERE id = ?
  `).run(
    clean.manifest.name,
    clean.manifest.description || '',
    clean.manifest.icon || '',
    JSON.stringify(clean.manifest),
    JSON.stringify(clean.schema),
    JSON.stringify(clean.ui),
    JSON.stringify(clean.actions),
    JSON.stringify(clean.prompts || {}),
    clean.manifest.version || '1.0.0',
    updatedAt,
    appId
  );
  return getApp(appId);
}

export function updateAppMetadata(appId, metadata = {}) {
  const app = getApp(appId);
  if (!app) return null;
  const pkg = appToPackage(app);
  const name = String(metadata.name || '').trim();
  const category = String(metadata.category || '').trim();
  const description = metadata.description === undefined ? null : String(metadata.description || '').trim();
  if (name) pkg.manifest.name = name;
  if (category) pkg.manifest.category = category;
  if (description !== null) pkg.manifest.description = description;
  return updateAppPackage(appId, pkg);
}

export function listApps() {
  return getDb()
    .prepare('SELECT * FROM apps ORDER BY updatedAt DESC')
    .all()
    .map(rowToApp);
}

export function getApp(id) {
  return rowToApp(getDb().prepare('SELECT * FROM apps WHERE id = ?').get(id));
}

export function deleteApp(id) {
  return getDb().prepare('DELETE FROM apps WHERE id = ?').run(id).changes > 0;
}

export function listRecords(appId, options = {}) {
  const rows = getDb()
    .prepare('SELECT * FROM records WHERE appId = ? ORDER BY updatedAt DESC')
    .all(appId);
  let records = rows.map((row) => ({
    id: row.id,
    appId: row.appId,
    entityId: row.entityId,
    data: JSON.parse(row.dataJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }));
  if (options.entityId) records = records.filter((record) => record.entityId === options.entityId);
  if (options.q) {
    const q = String(options.q).toLowerCase();
    records = records.filter((record) => JSON.stringify(record.data).toLowerCase().includes(q));
  }
  return records;
}

export function createRecord(appId, entityId, data) {
  const id = createId('rec');
  const createdAt = now();
  getDb()
    .prepare('INSERT INTO records (id, appId, entityId, dataJson, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, appId, entityId, JSON.stringify(data || {}), createdAt, createdAt);
  return getRecord(id);
}

export function getRecord(id) {
  const row = getDb().prepare('SELECT * FROM records WHERE id = ?').get(id);
  if (!row) return null;
  return {
    id: row.id,
    appId: row.appId,
    entityId: row.entityId,
    data: JSON.parse(row.dataJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function updateRecord(recordId, data) {
  getDb()
    .prepare('UPDATE records SET dataJson = ?, updatedAt = ? WHERE id = ?')
    .run(JSON.stringify(data || {}), now(), recordId);
  return getRecord(recordId);
}

export function deleteRecord(recordId) {
  return getDb().prepare('DELETE FROM records WHERE id = ?').run(recordId).changes > 0;
}

export function getSetting(key) {
  const row = getDb().prepare('SELECT valueJson FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.valueJson) : null;
}

export function setSetting(key, value) {
  getDb()
    .prepare(`
      INSERT INTO settings (key, valueJson, updatedAt) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET valueJson = excluded.valueJson, updatedAt = excluded.updatedAt
    `)
    .run(key, JSON.stringify(value), now());
  return value;
}

export function exportAppPayload(appId, dataMode = 'structure') {
  const app = getApp(appId);
  if (!app) throw new Error('找不到应用。');
  const payload = appToPackage(app);
  if (dataMode === 'sample' || dataMode === 'all') {
    payload.sampleData = listRecords(appId).map((record) => ({
      entityId: record.entityId,
      data: record.data
    }));
  }
  return payload;
}

export function importAppPayload(payload) {
  const sampleData = Array.isArray(payload.sampleData) ? payload.sampleData : [];
  const app = createAppFromPackage(payload);
  for (const record of sampleData) {
    createRecord(app.id, record.entityId, record.data);
  }
  return app;
}
