import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isChoiceField, isSingleChoiceField, isMultiChoiceField,
  isRelationField, isFormulaField, isNumericField,
  isDateField, isDateTimeField, isTemporalField,
  isFileLikeField, isTextLikeField
} from '../src/core/fieldTypeHelpers.js';

// ── isChoiceField ────────────────────────────────────────────────────────

test('isChoiceField — select and multiSelect return true', () => {
  assert.equal(isChoiceField({ type: 'select' }), true);
  assert.equal(isChoiceField({ type: 'multiSelect' }), true);
});

test('isChoiceField — non-choice types return false', () => {
  assert.equal(isChoiceField({ type: 'text' }), false);
  assert.equal(isChoiceField({ type: 'number' }), false);
  assert.equal(isChoiceField({ type: 'date' }), false);
  assert.equal(isChoiceField({ type: 'relation' }), false);
});

test('isChoiceField — null, undefined, unknown return false', () => {
  assert.equal(isChoiceField(null), false);
  assert.equal(isChoiceField(undefined), false);
  assert.equal(isChoiceField({}), false);
  assert.equal(isChoiceField({ type: undefined }), false);
  assert.equal(isChoiceField({ type: 'nonexistent' }), false);
});

// ── isSingleChoiceField ──────────────────────────────────────────────────

test('isSingleChoiceField — select returns true, multiSelect returns false', () => {
  assert.equal(isSingleChoiceField({ type: 'select' }), true);
  assert.equal(isSingleChoiceField({ type: 'multiSelect' }), false);
});

test('isSingleChoiceField — non-choice types return false', () => {
  assert.equal(isSingleChoiceField({ type: 'text' }), false);
  assert.equal(isSingleChoiceField({ type: 'number' }), false);
  assert.equal(isSingleChoiceField({ type: 'relation' }), false);
  assert.equal(isSingleChoiceField(null), false);
  assert.equal(isSingleChoiceField({}), false);
});

// ── isMultiChoiceField ───────────────────────────────────────────────────

test('isMultiChoiceField — multiSelect returns true, select returns false', () => {
  assert.equal(isMultiChoiceField({ type: 'multiSelect' }), true);
  assert.equal(isMultiChoiceField({ type: 'select' }), false);
});

test('isMultiChoiceField — non-choice types return false', () => {
  assert.equal(isMultiChoiceField({ type: 'text' }), false);
  assert.equal(isMultiChoiceField({ type: 'relation' }), false);
  assert.equal(isMultiChoiceField(null), false);
  assert.equal(isMultiChoiceField({}), false);
});

// ── isRelationField ──────────────────────────────────────────────────────

test('isRelationField — relation returns true', () => {
  assert.equal(isRelationField({ type: 'relation' }), true);
});

test('isRelationField — non-relation types return false', () => {
  assert.equal(isRelationField({ type: 'select' }), false);
  assert.equal(isRelationField({ type: 'text' }), false);
  assert.equal(isRelationField({ type: 'formula' }), false);
  assert.equal(isRelationField(null), false);
  assert.equal(isRelationField({}), false);
});

// ── isFormulaField ───────────────────────────────────────────────────────

test('isFormulaField — formula returns true', () => {
  assert.equal(isFormulaField({ type: 'formula' }), true);
});

test('isFormulaField — non-formula types return false', () => {
  assert.equal(isFormulaField({ type: 'text' }), false);
  assert.equal(isFormulaField({ type: 'number' }), false);
  assert.equal(isFormulaField(null), false);
  assert.equal(isFormulaField({}), false);
});

// ── isNumericField ───────────────────────────────────────────────────────

test('isNumericField — number returns true', () => {
  assert.equal(isNumericField({ type: 'number' }), true);
});

test('isNumericField — non-numeric types return false', () => {
  assert.equal(isNumericField({ type: 'text' }), false);
  assert.equal(isNumericField({ type: 'date' }), false);
  assert.equal(isNumericField({ type: 'select' }), false);
  assert.equal(isNumericField(null), false);
  assert.equal(isNumericField({}), false);
  assert.equal(isNumericField({ type: undefined }), false);
});

// ── isDateField / isDateTimeField / isTemporalField ─────────────────────

test('isDateField — date returns true, datetime returns false', () => {
  assert.equal(isDateField({ type: 'date' }), true);
  assert.equal(isDateField({ type: 'datetime' }), false);
});

test('isDateField — non-temporal types return false', () => {
  assert.equal(isDateField({ type: 'text' }), false);
  assert.equal(isDateField(null), false);
});

test('isDateTimeField — datetime returns true, date returns false', () => {
  assert.equal(isDateTimeField({ type: 'datetime' }), true);
  assert.equal(isDateTimeField({ type: 'date' }), false);
});

test('isDateTimeField — non-temporal types return false', () => {
  assert.equal(isDateTimeField({ type: 'text' }), false);
  assert.equal(isDateTimeField(null), false);
});

test('isTemporalField — date and datetime return true', () => {
  assert.equal(isTemporalField({ type: 'date' }), true);
  assert.equal(isTemporalField({ type: 'datetime' }), true);
});

test('isTemporalField — non-temporal types return false', () => {
  assert.equal(isTemporalField({ type: 'text' }), false);
  assert.equal(isTemporalField({ type: 'number' }), false);
  assert.equal(isTemporalField(null), false);
  assert.equal(isTemporalField({}), false);
});

// ── isFileLikeField ──────────────────────────────────────────────────────

test('isFileLikeField — image and file return true', () => {
  assert.equal(isFileLikeField({ type: 'image' }), true);
  assert.equal(isFileLikeField({ type: 'file' }), true);
});

test('isFileLikeField — non-file types return false', () => {
  assert.equal(isFileLikeField({ type: 'text' }), false);
  assert.equal(isFileLikeField({ type: 'select' }), false);
  assert.equal(isFileLikeField(null), false);
  assert.equal(isFileLikeField({}), false);
});

// ── isTextLikeField ──────────────────────────────────────────────────────

test('isTextLikeField — text, textarea, and richText return true', () => {
  assert.equal(isTextLikeField({ type: 'text' }), true);
  assert.equal(isTextLikeField({ type: 'textarea' }), true);
  assert.equal(isTextLikeField({ type: 'richText' }), true);
});

test('isTextLikeField — non-text types return false', () => {
  assert.equal(isTextLikeField({ type: 'number' }), false);
  assert.equal(isTextLikeField({ type: 'select' }), false);
  assert.equal(isTextLikeField({ type: 'url' }), false);
  assert.equal(isTextLikeField(null), false);
  assert.equal(isTextLikeField({}), false);
});

// ── Accept string in addition to field object ────────────────────────────

test('all helpers accept plain type string', () => {
  assert.equal(isChoiceField('select'), true);
  assert.equal(isSingleChoiceField('select'), true);
  assert.equal(isMultiChoiceField('multiSelect'), true);
  assert.equal(isRelationField('relation'), true);
  assert.equal(isFormulaField('formula'), true);
  assert.equal(isNumericField('number'), true);
  assert.equal(isDateField('date'), true);
  assert.equal(isDateTimeField('datetime'), true);
  assert.equal(isTemporalField('date'), true);
  assert.equal(isTemporalField('datetime'), true);
  assert.equal(isFileLikeField('image'), true);
  assert.equal(isFileLikeField('file'), true);
  assert.equal(isTextLikeField('text'), true);
  assert.equal(isTextLikeField('textarea'), true);
  assert.equal(isTextLikeField('richText'), true);
});

test('all helpers return false for unknown string type', () => {
  assert.equal(isChoiceField('bogus'), false);
  assert.equal(isRelationField('bogus'), false);
  assert.equal(isFormulaField('bogus'), false);
  assert.equal(isNumericField('bogus'), false);
  assert.equal(isTemporalField('bogus'), false);
  assert.equal(isFileLikeField('bogus'), false);
  assert.equal(isTextLikeField('bogus'), false);
});
