const ports = {
  closeContextMenu: () => {}, clearActiveTableSelection: () => {}, defaultValueForField: () => '',
  fieldValuesEqual: (left, right) => left === right, relationDisplayValue: () => '',
  displayValue: (value) => String(value ?? ''), hasDisplayValue: (value) => value != null && value !== '',
  resolveAiPrompt: (template) => String(template || ''), optionObject: (option) => option,
  effectiveFieldType: (field) => field?.type, fieldTypeLabel: (type) => type,
  optionLabel: (_field, value) => String(value ?? '')
};
export function configureRuntimePorts(next = {}) { Object.assign(ports, next); }
export const closeContextMenu = (...args) => ports.closeContextMenu(...args);
export const clearActiveTableSelection = (...args) => ports.clearActiveTableSelection(...args);
export const defaultValueForField = (...args) => ports.defaultValueForField(...args);
export const fieldValuesEqual = (...args) => ports.fieldValuesEqual(...args);
export const relationDisplayValue = (...args) => ports.relationDisplayValue(...args);
export const displayValue = (...args) => ports.displayValue(...args);
export const hasDisplayValue = (...args) => ports.hasDisplayValue(...args);
export const resolveAiPrompt = (...args) => ports.resolveAiPrompt(...args);
export const optionObject = (...args) => ports.optionObject(...args);
export const effectiveFieldType = (...args) => ports.effectiveFieldType(...args);
export const fieldTypeLabel = (...args) => ports.fieldTypeLabel(...args);
export const optionLabel = (...args) => ports.optionLabel(...args);
