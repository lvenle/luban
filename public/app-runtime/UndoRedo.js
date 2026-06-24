/**
 * Undo/Redo executor — reads from UndoStack and performs the API calls.
 * Keyboard shortcuts: Cmd/Ctrl+Z = undo, Cmd/Ctrl+Shift+Z = redo
 *
 * UndoStack stores actions as { type, recordId, entityId, oldData, newData, entityLabel }.
 * - undo() moves pointer back and returns the action (we execute its inverse)
 * - redo() moves pointer forward and returns the action (we execute it forward)
 * - pushUndo() truncates redo history and appends the new action
 */
import { api } from '../common/api.js';
import { toast } from '../common/toast.js';
import { state } from '../app.js';
import { loadCurrentPageRecords, renderRuntime } from './index.js';
import { undo, redo } from '../common/UndoStack.js';

async function updateRecord(recordId, data) {
  await api(`/api/apps/${state.currentApp.id}/records/${recordId}`, {
    method: 'PUT',
    body: JSON.stringify({ data })
  });
}

async function createRecord(entityId, data) {
  return api(`/api/apps/${state.currentApp.id}/records`, {
    method: 'POST',
    body: JSON.stringify({ entityId, data })
  });
}

async function deleteRecord(recordId) {
  try {
    await api(`/api/apps/${state.currentApp.id}/records/${recordId}`, { method: 'DELETE' });
  } catch (error) {
    if (/引用/.test(error.message)) {
      await api(`/api/apps/${state.currentApp.id}/records/${recordId}?force=true`, { method: 'DELETE' });
    } else {
      throw error;
    }
  }
}

function toastAction(type, label) {
  const typeLabel = { update: '修改', create: '新增', delete: '删除' }[type] || type;
  toast(`${label}：${typeLabel}`);
}

export async function undoLastAction() {
  if (!state.currentApp) return;
  const action = undo();
  if (!action) return toast('没有可撤销的操作。');

  try {
    if (action.type === 'update') {
      // Inverse: restore old data
      await updateRecord(action.recordId, action.oldData);
    } else if (action.type === 'create') {
      // Inverse: delete the created record
      await deleteRecord(action.recordId);
    } else if (action.type === 'delete') {
      // Inverse: re-create the deleted record
      await createRecord(action.entityId, action.data);
    }
    await loadCurrentPageRecords();
    renderRuntime();
    toastAction(action.type, '撤销');
  } catch (error) {
    toast(`撤销失败：${error.message}`);
  }
}

export async function redoLastAction() {
  if (!state.currentApp) return;
  const action = redo();
  if (!action) return toast('没有可重做的操作。');

  try {
    if (action.type === 'update') {
      // Re-apply new data
      await updateRecord(action.recordId, action.newData);
    } else if (action.type === 'create') {
      // Re-create
      await createRecord(action.entityId, action.data);
    } else if (action.type === 'delete') {
      // Re-delete
      await deleteRecord(action.recordId);
    }
    await loadCurrentPageRecords();
    renderRuntime();
    toastAction(action.type, '重做');
  } catch (error) {
    toast(`重做失败：${error.message}`);
  }
}

export function setupUndoShortcuts() {
  document.addEventListener('keydown', (event) => {
    if (!state.currentApp) return;
    const mod = event.metaKey || event.ctrlKey;
    if (!mod) return;
    if (event.key === 'z' && !event.shiftKey) {
      event.preventDefault();
      undoLastAction();
      return;
    }
    if (event.key === 'z' && event.shiftKey) {
      event.preventDefault();
      redoLastAction();
      return;
    }
    // Handle 'Z' (caps lock) — shift check via event.shiftKey
    if (event.key === 'Z') {
      event.preventDefault();
      if (event.shiftKey) redoLastAction();
      else undoLastAction();
    }
  });
}
