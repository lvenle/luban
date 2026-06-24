/**
 * Undo/Redo stack for record operations.
 *
 * Usage:
 *   import { pushUndo, undo, redo } from '../common/UndoStack.js';
 *
 *   pushUndo({ type: 'update', recordId, entityId, oldData, newData });
 *   undo();  // reverts the last operation
 *   redo();  // re-applies a reverted operation
 */

const MAX_SIZE = 50;
const stack = [];
let index = -1;  // points to the last applied action; -1 means empty

export function pushUndo(action) {
  // Discard any redo history beyond current index
  stack.length = index + 1;
  stack.push(action);
  if (stack.length > MAX_SIZE) stack.shift();
  else index++;
}

export function canUndo() {
  return index >= 0;
}

export function canRedo() {
  return index < stack.length - 1;
}

export function peekUndo() {
  return index >= 0 ? stack[index] : null;
}

export function peekRedo() {
  return index < stack.length - 1 ? stack[index + 1] : null;
}

export function undo() {
  if (index < 0) return null;
  const action = stack[index];
  index--;
  return action;
}

export function redo() {
  if (index >= stack.length - 1) return null;
  index++;
  return stack[index];
}

export function clearUndoStack() {
  stack.length = 0;
  index = -1;
}

export function undoCount() {
  return index + 1;
}

export function redoCount() {
  return stack.length - index - 1;
}
