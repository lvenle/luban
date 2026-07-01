/**
 * Debounced AI field trigger system.
 *
 * After a record is saved, call `checkAiTriggers(entity, record, oldData)`.
 * It finds AI fields whose trigger fields changed from empty → non-empty,
 * debounces 800ms per record for stability, then resolves the prompt and
 * calls the AI generation endpoint.
 */
import { api } from '../common/api.js';
import { toast } from '../common/toast.js';
import { state } from '../app-context.js';
import { loadCurrentPageRecords, renderRuntime } from './runtime-actions.js';
import { resolveAiPrompt } from './runtime-ports.js';

const pendingTimers = new Map(); // recordId → timeoutId

function isEmpty(value) {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

function isNotEmpty(value) {
  return !isEmpty(value);
}

/**
 * Called after a record save (create or update).
 * Checks whether any AI field in the entity has trigger fields that
 * transitioned from empty → non-empty. If so, debounces and triggers AI.
 *
 * @param {object} entity  - The entity definition
 * @param {object} record  - The saved record (with data)
 * @param {object|null} oldData - The previous record data (null for new records, meaning all fields started empty)
 */
export function checkAiTriggers(entity, record, oldData = null) {
  const aiFields = entity.fields.filter((f) => f.type === 'ai' && f.aiConfig?.prompt && f.aiConfig?.triggerFieldIds?.length);
  if (!aiFields.length) return;

  // Find which AI fields should trigger for this record
  let toTrigger = [];
  for (const aiField of aiFields) {
    for (const triggerId of aiField.aiConfig.triggerFieldIds) {
      const newVal = record.data[triggerId];
      const oldVal = oldData ? oldData[triggerId] : undefined;
      if (isNotEmpty(newVal) && isEmpty(oldVal)) {
        toTrigger.push(aiField);
        break; // this AI field triggered, move to next
      }
    }
  }

  if (!toTrigger.length) return;

  // Only trigger for AI fields that are still empty (prevents re-trigger on refresh)
  toTrigger = toTrigger.filter((f) => isEmpty(record.data[f.id]));

  if (!toTrigger.length) return;

  // Debounce per record: cancel previous pending timer for this record
  const existing = pendingTimers.get(record.id);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    pendingTimers.delete(record.id);
    for (const aiField of toTrigger) {
      // Write "生成中…" placeholder immediately
      const generatingText = '生成中…';
      const placeholderData = { ...record.data, [aiField.id]: generatingText };
      try {
        await api(`/api/apps/${state.currentApp.id}/records/${record.id}`, { method: 'PUT', body: JSON.stringify({ data: placeholderData }) });
        record.data[aiField.id] = generatingText;
        await loadCurrentPageRecords();
        renderRuntime();
      } catch { /* skip — will retry on next save */ }

      try {
        const prompt = resolveAiPrompt(aiField.aiConfig.prompt, entity, record);
        if (!prompt.trim()) {
          // Clear placeholder if prompt is empty
          const clearData = { ...record.data, [aiField.id]: '' };
          await api(`/api/apps/${state.currentApp.id}/records/${record.id}`, { method: 'PUT', body: JSON.stringify({ data: clearData }) });
          record.data[aiField.id] = '';
          continue;
        }
        const body = await api(`/api/apps/${state.currentApp.id}/ai-field`, {
          method: 'POST',
          body: JSON.stringify({ recordId: record.id, fieldId: aiField.id, prompt }),
          signal: AbortSignal.timeout(30000)
        });
        if (body.result) {
          const data = { ...record.data, [aiField.id]: body.result };
          await api(`/api/apps/${state.currentApp.id}/records/${record.id}`, { method: 'PUT', body: JSON.stringify({ data }) });
          record.data[aiField.id] = body.result;
        }
      } catch (error) {
        console.error(`[AI Trigger] ${aiField.label} 生成失败:`, error.message);
        // Write failure placeholder
        const failedText = error.name === 'TimeoutError' ? '生成超时' : '生成失败';
        const failData = { ...record.data, [aiField.id]: failedText };
        try {
          await api(`/api/apps/${state.currentApp.id}/records/${record.id}`, { method: 'PUT', body: JSON.stringify({ data: failData }) });
          record.data[aiField.id] = failedText;
        } catch { /* best-effort */ }
      }
    }
    await loadCurrentPageRecords();
    renderRuntime();
  }, 800);

  pendingTimers.set(record.id, timer);
}

/**
 * Cancel any pending AI trigger for a record (e.g., when user navigates away).
 */
export function cancelAiTriggers(recordId) {
  const timer = pendingTimers.get(recordId);
  if (timer) { clearTimeout(timer); pendingTimers.delete(recordId); }
}
