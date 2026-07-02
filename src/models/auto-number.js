export function normalizeAutoNumberConfig(field = {}) {
  const config = field.autoNumber || field.config?.autoNumber || {};
  const start = Number.parseInt(config.start, 10);
  const step = Number.parseInt(config.step, 10);
  return {
    start: Number.isInteger(start) && start >= 0 ? start : 1,
    step: Number.isInteger(step) && step > 0 ? step : 1,
    prefix: String(config.prefix || '')
  };
}

export function allocateAutoNumberValues(database, appId, entity, data = {}) {
  const next = { ...data };
  for (const field of entity?.fields || []) {
    if (field.type !== 'autoNumber') continue;
    const config = normalizeAutoNumberConfig(field);
    database.prepare(`
      INSERT OR IGNORE INTO auto_number_sequences (appId, entityId, fieldId, nextValue)
      VALUES (?, ?, ?, ?)
    `).run(appId, entity.id, field.id, config.start);
    const sequence = database.prepare(`
      SELECT nextValue FROM auto_number_sequences
      WHERE appId = ? AND entityId = ? AND fieldId = ?
    `).get(appId, entity.id, field.id);
    const value = Number(sequence?.nextValue ?? config.start);
    database.prepare(`
      UPDATE auto_number_sequences SET nextValue = ?
      WHERE appId = ? AND entityId = ? AND fieldId = ?
    `).run(value + config.step, appId, entity.id, field.id);
    next[field.id] = `${config.prefix}${value}`;
  }
  return next;
}

export function syncAutoNumberFields(database, appId, schema = {}, previousSchema = {}) {
  for (const previousEntity of previousSchema.entities || []) {
    const nextEntity = (schema.entities || []).find((entity) => entity.id === previousEntity.id);
    for (const previousField of previousEntity.fields || []) {
      const nextField = nextEntity?.fields?.find((field) => field.id === previousField.id);
      if (previousField.type === 'autoNumber' && nextField && nextField.type !== 'autoNumber') {
        const error = new Error(`字段「${previousField.label}」是系统生成的自增序号，不能直接修改为其他类型。`);
        error.status = 409;
        throw error;
      }
      if (previousField.type !== 'autoNumber' && nextField?.type === 'autoNumber') {
        const hasValues = database.prepare('SELECT dataJson FROM records WHERE appId = ? AND entityId = ?').all(appId, previousEntity.id)
          .some((row) => {
            const value = JSON.parse(row.dataJson)?.[previousField.id];
            return value !== undefined && value !== null && value !== '';
          });
        if (hasValues) {
          const error = new Error(`字段「${previousField.label}」已有数据，不能直接改为自增序号。请新建一个自增序号字段。`);
          error.status = 409;
          throw error;
        }
      }
    }
  }

  const activeKeys = [];
  for (const entity of schema.entities || []) {
    for (const field of entity.fields || []) {
      if (field.type !== 'autoNumber') continue;
      activeKeys.push(`${entity.id}\u0000${field.id}`);
      const existingSequence = database.prepare(`
        SELECT nextValue FROM auto_number_sequences
        WHERE appId = ? AND entityId = ? AND fieldId = ?
      `).get(appId, entity.id, field.id);
      if (existingSequence) continue;

      const config = normalizeAutoNumberConfig(field);
      const rows = database.prepare(`
        SELECT id, dataJson FROM records
        WHERE appId = ? AND entityId = ?
        ORDER BY createdAt ASC, rowid ASC
      `).all(appId, entity.id);
      let nextValue = config.start;
      const update = database.prepare('UPDATE records SET dataJson = ?, updatedAt = ? WHERE id = ?');
      for (const row of rows) {
        const recordData = JSON.parse(row.dataJson);
        recordData[field.id] = `${config.prefix}${nextValue}`;
        update.run(JSON.stringify(recordData), new Date().toISOString(), row.id);
        nextValue += config.step;
      }
      database.prepare(`
        INSERT INTO auto_number_sequences (appId, entityId, fieldId, nextValue)
        VALUES (?, ?, ?, ?)
      `).run(appId, entity.id, field.id, nextValue);
    }
  }

  const rows = database.prepare('SELECT entityId, fieldId FROM auto_number_sequences WHERE appId = ?').all(appId);
  const active = new Set(activeKeys);
  const remove = database.prepare('DELETE FROM auto_number_sequences WHERE appId = ? AND entityId = ? AND fieldId = ?');
  for (const row of rows) {
    if (!active.has(`${row.entityId}\u0000${row.fieldId}`)) remove.run(appId, row.entityId, row.fieldId);
  }
}
