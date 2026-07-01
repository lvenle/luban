import { getDb, rowToApp, triggerBackup } from '../storage/db.js';
import { preparePackage } from '../core/packageProtocol.js';
import { createId, slugify } from '../core/ids.js';
import { formulaDependents } from '../core/formula.js';
import { isFormulaField } from '../core/fieldTypeHelpers.js';
import { notFound } from '../core/errors.js';

function now() {
  return new Date().toISOString();
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
  triggerBackup();
  return getApp(id);
}

export function updateAppPackage(appId, pkg, options = {}) {
  const database = getDb();
  const existing = getApp(appId);
  if (!existing) throw notFound('找不到应用。');
  if (options.expectedUpdatedAt && existing.updatedAt !== options.expectedUpdatedAt) {
    const error = new Error('软件已在其他页面发生变化，请刷新后重试。');
    error.status = 409;
    error.details = { expectedUpdatedAt: options.expectedUpdatedAt, actualUpdatedAt: existing.updatedAt };
    throw error;
  }
  if (existing) validateFormulaDependencyChanges(existing, pkg);
  const clean = preparePackage(pkg);
  const updatedAt = nextTimestamp(existing.updatedAt);
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

function nextTimestamp(previous) {
  const prior = Date.parse(previous || '') || 0;
  return new Date(Math.max(Date.now(), prior + 1)).toISOString();
}

function validateFormulaDependencyChanges(existing, nextPackage) {
  for (const oldEntity of existing.schema?.entities || []) {
    const nextEntity = nextPackage.schema?.entities?.find((item) => item.id === oldEntity.id);
    if (!nextEntity) continue;
    for (const oldField of oldEntity.fields || []) {
      const dependents = formulaDependents(oldEntity, oldField.id)
        .filter((formula) => nextEntity.fields?.some((field) => field.id === formula.id && isFormulaField(field)));
      if (!dependents.length) continue;
      const nextField = nextEntity.fields?.find((field) => field.id === oldField.id);
      if (!nextField || nextField.type !== oldField.type) {
        const action = nextField ? '修改类型' : '删除';
        const error = new Error(`不能${action}字段「${oldField.label}」，以下公式正在引用它：${dependents.map((item) => item.label).join('、')}`);
        error.status = 409;
        error.details = { fieldId: oldField.id, formulaFields: dependents.map((item) => ({ id: item.id, label: item.label })) };
        throw error;
      }
    }
  }
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
  return updateAppPackage(appId, pkg, { expectedUpdatedAt: metadata.expectedUpdatedAt });
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
