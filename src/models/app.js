import { getDb, rowToApp, getPackageFromApp } from '../storage/db.js';
import { preparePackage } from '../core/packageProtocol.js';
import { createId, slugify } from '../core/ids.js';

function now() {
  return new Date().toISOString();
}

function notFoundError(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
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
  const pkg = { manifest: app.manifest, schema: app.schema, ui: app.ui, actions: app.actions, prompts: app.prompts || {} };
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

export async function exportAppPayload(appId, dataMode = 'structure') {
  const app = getApp(appId);
  if (!app) throw new Error('找不到应用。');
  const payload = { manifest: app.manifest, schema: app.schema, ui: app.ui, actions: app.actions, prompts: app.prompts || {} };
  if (dataMode === 'sample' || dataMode === 'all') {
    const { listRecords } = await import('./record.js');
    payload.sampleData = listRecords(appId).map((record) => ({
      entityId: record.entityId,
      data: record.data
    }));
  }
  return payload;
}

export async function importAppPayload(payload) {
  const sampleData = Array.isArray(payload.sampleData) ? payload.sampleData : [];
  const app = createAppFromPackage(payload);
  if (sampleData.length) {
    const { createRecord } = await import('./record.js');
    for (const record of sampleData) {
      createRecord(app.id, record.entityId, record.data);
    }
  }
  return app;
}
