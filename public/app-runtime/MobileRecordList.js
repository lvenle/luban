import { h } from '../common/dom.js';
import { state, storageKey, viewOrderedFields, applyViewFilters, sortRecords } from '../app.js';
import { renderViewBar, openFilterModal, openSortModal, openGroupModal, getListConfig, setListConfig } from './ViewBar.js';
import { openRecordModal, removeRecord } from './RecordModal.js';
import { openConfirmDialog } from '../common/modal.js';
import { toast } from '../common/toast.js';
import { readStorage, writeStorage } from '../common/storage.js';
import { renderRuntime, loadCurrentPageRecords, renderInfiniteLoadSentinel } from './index.js';
import { optionLabel } from './FieldEditor.js';

function pickTitleField(visibleFields) {
  for (const f of visibleFields) {
    if (!['image', 'file', 'boolean', 'formula', 'relation'].includes(f.type)) return f;
  }
  return visibleFields[0];
}

function pickDetailFields(visibleFields, titleField) {
  const result = [];
  for (const f of visibleFields) {
    if (f.id === titleField?.id) continue;
    if (['image', 'file', 'relation'].includes(f.type)) continue;
    if (result.length >= 4) break;
    result.push(f);
  }
  return result;
}

function valueToText(raw, field) {
  if (raw == null || raw === '') return '';
  if (field.type === 'select') {
    return optionLabel(field, raw);
  }
  if (field.type === 'multiSelect') {
    return (Array.isArray(raw) ? raw : []).map((v) => optionLabel(field, v)).filter(Boolean).join('、');
  }
  if (field.type === 'date' || field.type === 'datetime') {
    return String(raw).slice(0, 10);
  }
  if (field.type === 'number') {
    const n = Number(raw);
    if (!Number.isNaN(n)) {
      if (field.format === 'currency') return `¥${n.toFixed(2)}`;
      if (field.format === 'percent') return `${(n * 100).toFixed(1)}%`;
      return Number.isInteger(n) ? String(n) : n.toFixed(2);
    }
    return String(raw);
  }
  if (raw === true) return '是';
  if (raw === false) return '否';
  if (Array.isArray(raw)) return raw.map((i) => String(i?.displayValue || i?.label || i || '')).filter(Boolean).join('、');
  if (raw && typeof raw === 'object') return String(raw.displayValue || raw.label || raw.name || raw.optionId || '');
  return String(raw);
}

let mobileSearchQuery = '';

export function renderMobileRecordList(page) {
  console.log('[MobileRecordList] rendering', state.isMobile);
  const entity = state.currentApp.schema.entities.find((e) => e.id === page.entity);
  if (!entity) return h('div', { class: 'panel', text: '没有关联的实体。' });
  const allRecords = state.records.filter((r) => r.entityId === entity.id);
  const listConfig = getListConfig(entity);
  let filtered = sortRecords(applyViewFilters(allRecords, entity, listConfig), listConfig);

  if (mobileSearchQuery) {
    const q = mobileSearchQuery.toLowerCase();
    filtered = filtered.filter((r) => JSON.stringify(r.data).toLowerCase().includes(q));
  }

  const visibleFields = viewOrderedFields(entity, listConfig).filter((f) => listConfig.visibleFields.includes(f.id));
  const titleField = pickTitleField(visibleFields);
  const detailFields = pickDetailFields(visibleFields, titleField);

  const selKey = storageKey('mobile-sel', entity.id);
  const selectedIds = new Set(readStorage(selKey, []));
  const syncSel = () => writeStorage(selKey, [...selectedIds]);

  const selCount = selectedIds.size;

  const cards = filtered.map((record) => {
    const checked = selectedIds.has(record.id);
    const title = titleField ? (valueToText(record.data[titleField.id], titleField) || '未命名') : '记录';

    const card = h('div', { class: `mobile-record-card ${checked ? 'selected' : ''}` }, [
      h('div', { class: 'mobile-card-main', onclick: () => { openRecordModal(entity, record); } }, [
        h('input', {
          type: 'checkbox', checked: checked ? 'checked' : null,
          onclick: (e) => e.stopPropagation(),
          onchange: (e) => {
            e.currentTarget.checked ? selectedIds.add(record.id) : selectedIds.delete(record.id);
            syncSel();
            renderRuntime();
          }
        }),
        h('div', { class: 'mobile-card-body' }, [
          h('div', { class: 'mobile-card-title', text: title }),
          ...detailFields.map((f) => {
            const raw = record.data[f.id];
            if (raw == null || raw === '' || (Array.isArray(raw) && raw.length === 0)) return null;
            const text = valueToText(raw, f);
            if (!text) return null;
            return h('div', { class: 'mobile-card-detail' }, [
              h('span', { class: 'mobile-card-label', text: f.label }),
              h('span', { class: 'mobile-card-value', text: text })
            ]);
          }).filter(Boolean)
        ])
      ]),
      h('div', { class: 'mobile-card-tail' }, [
        h('button', {
          class: 'ghost mobile-card-menu-btn', text: '⋮', title: '操作',
          onclick: (e) => { e.stopPropagation(); showCardMenu(e.currentTarget, entity, record); }
        })
      ])
    ]);
    return card;
  });

  function showCardMenu(anchor, entity, record) {
    closeCardMenu();
    const rect = anchor.getBoundingClientRect();
    const menu = h('div', { class: 'context-menu mobile-card-menu', style: `right:${Math.min(8, window.innerWidth - rect.right - 4)}px;top:${Math.min(rect.bottom + 4, window.innerHeight - 160)}px` }, [
      h('button', { class: 'ghost-menu', text: '编辑', onclick: () => { closeCardMenu(); openRecordModal(entity, record); } }),
      h('button', { class: 'ghost-menu', text: '复制', onclick: () => { closeCardMenu(); duplicateRecord(entity, record); } }),
      h('button', { class: 'danger ghost-menu', text: '删除', onclick: () => { closeCardMenu(); removeRecord(record.id, entity.id); } })
    ]);
    document.body.append(menu);
    setTimeout(() => document.addEventListener('click', closeCardMenu, { once: true }), 0);
  }

  return h('div', { class: 'panel table-panel mobile-record-panel' }, [
    renderViewBar(entity, listConfig),

    h('div', { class: 'mobile-toolbar' }, [
      h('div', { class: 'mobile-toolbar-chips' }, [
        h('button', { class: `chip ${(listConfig.filters || []).length ? 'active' : ''}`, text: '筛选', onclick: () => openFilterModal(entity) }),
        h('button', { class: `chip ${(listConfig.sorts || []).length ? 'active' : ''}`, text: '排序', onclick: () => openSortModal(entity) }),
        h('button', { class: `chip ${listConfig.group?.field ? 'active' : ''}`, text: '分组', onclick: () => openGroupModal(entity) })
      ]),
      h('div', { class: 'mobile-toolbar-right' }, [
        selCount ? h('button', { class: 'secondary mobile-batch-btn', text: `删除 ${selCount}`, onclick: () => batchDelete(entity, selectedIds, selKey) }) : null
      ])
    ]),

    h('div', { class: 'mobile-search-bar' }, [
      h('input', {
        class: 'mobile-search-input', placeholder: '搜索全部记录...',
        value: mobileSearchQuery,
        oninput: (e) => { mobileSearchQuery = e.currentTarget.value; renderRuntime(); }
      }),
      mobileSearchQuery ? h('button', { class: 'ghost mobile-search-clear', text: '✕', onclick: () => { mobileSearchQuery = ''; renderRuntime(); } }) : null
    ]),

    ...(cards.length ? cards : [h('div', { class: 'mobile-empty muted', text: mobileSearchQuery ? '未找到匹配的记录。' : '暂无记录。' })]),

    renderInfiniteLoadSentinel(entity)
  ]);
}

function closeCardMenu() {
  document.querySelectorAll('.mobile-card-menu').forEach((m) => m.remove());
}

async function duplicateRecord(entity, record) {
  try {
    const body = await (await fetch(`/api/apps/${state.currentApp.id}/records`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entityId: entity.id, data: record.data })
    })).json();
    await loadCurrentPageRecords();
    renderRuntime();
    toast('已复制');
  } catch (err) { toast(err.message); }
}

async function batchDelete(entity, selectedIds, selKey) {
  const ids = [...selectedIds];
  if (!ids.length) return;
  openConfirmDialog({
    title: '批量删除', message: `确定删除选中的 ${ids.length} 条记录吗？`,
    confirmText: '删除', danger: true,
    onConfirm: async () => {
      try {
        const body = await (await fetch(`/api/apps/${state.currentApp.id}/records/bulk-delete`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ recordIds: ids, force: false })
        })).json();
        selectedIds.clear();
        writeStorage(selKey, []);
        await loadCurrentPageRecords();
        renderRuntime();
        toast(`已删除 ${body.deletedCount} 条`);
      } catch (error) { toast(error.message); }
    }
  });
}
