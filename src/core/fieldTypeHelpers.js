// Field-type semantic helpers — wrap raw metadata checks with readable names.
// Import these instead of writing field.type === 'select' || field.type === 'multiSelect'.

import { FIELD_TYPES } from './contract.js';

const meta = (fieldOrType) => {
  const type = typeof fieldOrType === 'string' ? fieldOrType : fieldOrType?.type;
  return FIELD_TYPES[type] || null;
};

export function isChoiceField(field)     { return Boolean(meta(field)?.isChoiceType); }
export function isSingleChoiceField(field)  { return Boolean(meta(field)?.isSingleChoiceType); }
export function isMultiChoiceField(field)   { return Boolean(meta(field)?.isMultiChoiceType); }
export function isRelationField(field)   { return Boolean(meta(field)?.isRelationType); }
export function isFormulaField(field)    { return Boolean(meta(field)?.isFormulaType); }
export function isNumericField(field)    { return Boolean(meta(field)?.isNumericType); }
export function isDateField(field)       { return Boolean(meta(field)?.isDateType && !meta(field)?.isDateTimeType); }
export function isDateTimeField(field)   { return Boolean(meta(field)?.isDateTimeType); }
export function isTemporalField(field)   { return Boolean(meta(field)?.isTemporalType); }
export function isFileLikeField(field)   { return Boolean(meta(field)?.isFileLikeType); }
export function isTextLikeField(field)   { return Boolean(meta(field)?.isTextLikeType); }
