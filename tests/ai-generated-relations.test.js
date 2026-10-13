import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAiCreatedPackage } from '../src/ai/service.js';
import { preparePackage } from '../src/core/packageProtocol.js';

function clinic() {
  return {
    manifest: { name: '诊所看诊' },
    schema: { entities: [
      { id: 'prescription', name: '处方', fields: [
        { id: 'field_prescription_record', label: '就诊记录', type: 'relation', targetEntity: 'record', displayField: 'name' }
      ] },
      { id: 'record', name: '就诊记录', fields: [
        { id: 'field_record_title', label: '病历标题', type: 'text' },
        { id: 'field_record_number', label: '就诊编号', type: 'autoNumber' }
      ] }
    ] },
    ui: { pages: [{ id: 'prescriptions', title: '处方', type: 'table', entity: 'prescription' }] }
  };
}

test('generated forward relation resolves nonexistent name after all tables exist', () => {
  const raw = clinic();
  assert.throws(() => preparePackage(raw), /不存在的展示字段/);
  const pkg = preparePackage(normalizeAiCreatedPackage(raw));
  const field = pkg.schema.entities[0].fields[0];
  assert.equal(field.displayField, 'field_record_number');
  assert.equal(field.config.displayField, field.displayField);
  assert.equal(raw.schema.entities[0].fields[0].displayField, 'name');
});

test('generated references resolve exact field prefix and preserve valid custom display', () => {
  const raw = clinic();
  raw.schema.entities[0].fields[0].displayField = 'record_title';
  assert.equal(normalizeAiCreatedPackage(raw).schema.entities[0].fields[0].displayField, 'field_record_title');
  raw.schema.entities[0].fields[0].displayField = 'field_record_title';
  assert.equal(normalizeAiCreatedPackage(raw).schema.entities[0].fields[0].displayField, 'field_record_title');
});

test('generated relation cannot invent a missing target table', () => {
  const raw = clinic();
  raw.schema.entities[0].fields[0].targetEntity = 'missing';
  assert.throws(() => preparePackage(normalizeAiCreatedPackage(raw)), /missing/);
});
