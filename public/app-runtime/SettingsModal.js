import { h } from '../common/dom.js';
import { api } from '../common/api.js';
import { toast } from '../common/toast.js';
import { formatRuleChanges } from './RuleFeedback.js';
import { humanizeMessage } from '../common/messages.js';
import { entityDisplayName } from '../common/entity-display.js';
import { loadApps } from '../app-home/home-actions.js';

function formatTime(value) {
  if (!value) return '暂无';
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function statusLabel(status) {
  return ({ active: '启用', disabled: '禁用', draft: '草稿', waiting: '等待条件', success: '成功', blocked: '已阻止', failed: '失败', skipped: '已跳过' })[status] || status;
}

function jsonDetails(title, value) {
  return h('details', { class: 'rule-json-details' }, [
    h('summary', { text: title }),
    h('pre', { text: JSON.stringify(value || {}, null, 2) })
  ]);
}

function ruleSummary(rule) {
  const intent = rule.businessIntentJson || {};
  return {
    when: intent.display?.when || intent.summary || rule.sourceText,
    then: intent.display?.then || rule.description || '执行字段联动'
  };
}

function renderRun(run, ruleName = '', app = null) {
  const changes = formatRuleChanges({ changes: run.outputSnapshotJson?.updates || [] }, app);
  const fallbackStep = [...(run.stepsJson || [])].reverse().find((step) => step.status === 'blocked' || step.status === 'failed')
    || (run.stepsJson || []).find((step) => step.status === 'skipped');
  const resultSummary = changes.length
    ? changes.join('；')
    : run.errorMessage
      ? humanizeMessage(run.errorMessage)
      : fallbackStep
        ? humanizeMessage(fallbackStep.message || fallbackStep.type)
        : run.status === 'success' ? '业务处理已完成。' : statusLabel(run.status);
  return h('details', { class: `business-rule-run run-${run.status}` }, [
    h('summary', {}, [
      h('span', { class: 'business-rule-run-summary-main' }, [
        h('span', { class: `business-rule-status status-${run.status}`, text: statusLabel(run.status) }),
        ruleName ? h('strong', { text: ruleName }) : null,
        h('span', { text: formatTime(run.createdAt) })
      ]),
      h('span', { class: 'business-rule-run-result', text: resultSummary })
    ]),
    h('div', { class: 'business-rule-run-body' }, [
      ...(run.stepsJson || []).map((step, index) => h('p', { text: `${index + 1}. ${humanizeMessage(step.message || step.type)}` })),
      ...changes.map((change) => h('p', { class: 'business-rule-change-detail', text: change })),
      run.errorMessage ? h('p', { class: 'business-rule-error', text: humanizeMessage(run.errorMessage) }) : null,
      run.idempotencyKey ? h('details', { class: 'rule-json-details' }, [
        h('summary', { text: '技术信息（高级）' }),
        h('code', { text: run.idempotencyKey })
      ]) : null
    ])
  ]);
}

function renderAllRunsPanel(panel, rules, runs, app) {
  const names = new Map(rules.map((rule) => [rule.id, rule.name]));
  if (!runs.length) {
    panel.replaceChildren(h('div', { class: 'business-rules-empty' }, [
      h('div', { class: 'business-rules-empty-icon', text: '🧾' }),
      h('h3', { text: '当前应用还没有执行记录' }),
      h('p', { text: '业务规则触发后，成功、阻止、失败和跳过记录都会显示在这里。' })
    ]));
    return;
  }
  panel.replaceChildren(h('div', { class: 'business-rule-runs all-rule-runs' },
    runs.map((run) => renderRun(run, names.get(run.ruleId) || run.ruleId, app))
  ));
}

function setSelectOptions(select, items, selectedValue) {
  select.replaceChildren(...items.map((item) => h('option', { value: item.value, text: item.label })));
  select.value = selectedValue ?? items[0]?.value ?? '';
}

function editableFields(entity) {
  return (entity?.fields || []).filter((field) => !['formula', 'relation', 'ai'].includes(field.type));
}

function openManualRuleEditor(container, appId, app, rule, onCancel) {
  const intent = rule.businessIntentJson || {};
  const name = h('input', { value: rule.name });
  const triggerEvent = h('select');
  const triggerEntity = h('select');
  const triggerField = h('select');
  const fromValue = h('input', { value: intent.trigger?.from ?? '', placeholder: '原值或选项 ID' });
  const toValue = h('input', { value: intent.trigger?.to ?? '', placeholder: '新值或选项 ID' });
  const relationField = h('select');
  const targetField = h('select');
  const operation = h('select');
  const valueType = h('select');
  const sourceField = h('select');
  const literalValue = h('input', { value: intent.action?.value?.value ?? '', placeholder: '固定值' });
  const updatedOnly = h('div', { class: 'manual-rule-updated-fields' }, [
    h('div', { class: 'field' }, [h('label', { text: '触发字段' }), triggerField]),
    h('div', { class: 'field' }, [h('label', { text: '从' }), fromValue]),
    h('div', { class: 'field' }, [h('label', { text: '变为' }), toValue])
  ]);
  const sourceFieldWrap = h('div', { class: 'field' }, [h('label', { text: '取值字段' }), sourceField]);
  const literalWrap = h('div', { class: 'field' }, [h('label', { text: '固定值' }), literalValue]);
  const entities = app.schema?.entities || [];
  setSelectOptions(triggerEvent, [
    { value: 'record.created', label: '新增记录时' },
    { value: 'record.updated', label: '字段值变化时' }
  ], intent.trigger?.event || rule.contractJson?.trigger?.type || 'record.updated');
  setSelectOptions(triggerEntity, entities.map((entity) => ({ value: entity.id, label: entityDisplayName(app, entity) })), intent.trigger?.entity);
  setSelectOptions(operation, [
    { value: 'set', label: '设置为' }, { value: 'increment', label: '增加' }, { value: 'decrement', label: '减少' }
  ], intent.action?.operation || 'set');
  setSelectOptions(valueType, [
    { value: 'trigger.field', label: '使用触发记录字段' }, { value: 'literal', label: '使用固定值' }
  ], intent.action?.value?.type || 'trigger.field');

  const refresh = () => {
    const sourceEntity = entities.find((entity) => entity.id === triggerEntity.value) || entities[0];
    setSelectOptions(triggerField, editableFields(sourceEntity).map((field) => ({ value: field.id, label: `${field.label} (${field.id})` })), triggerField.dataset.ready ? triggerField.value : intent.trigger?.field);
    triggerField.dataset.ready = 'true';
    const relations = (sourceEntity?.fields || []).filter((field) => field.type === 'relation' && entities.some((entity) => entity.id === field.targetEntity));
    setSelectOptions(relationField, [
      { value: '', label: '当前记录' },
      ...relations.map((field) => ({ value: field.id, label: `${field.label} → ${entityDisplayName(app, field.targetEntity)}` }))
    ], relationField.dataset.ready ? relationField.value : (intent.target?.relationField || ''));
    relationField.dataset.ready = 'true';
    const relation = relations.find((field) => field.id === relationField.value);
    const targetEntity = relation ? entities.find((entity) => entity.id === relation.targetEntity) : sourceEntity;
    setSelectOptions(targetField, editableFields(targetEntity).map((field) => ({ value: field.id, label: `${field.label} (${field.id})` })), targetField.dataset.ready ? targetField.value : intent.target?.field);
    targetField.dataset.ready = 'true';
    setSelectOptions(sourceField, editableFields(sourceEntity).map((field) => ({ value: field.id, label: `${field.label} (${field.id})` })), sourceField.dataset.ready ? sourceField.value : intent.action?.value?.field);
    sourceField.dataset.ready = 'true';
    updatedOnly.hidden = triggerEvent.value !== 'record.updated';
    sourceFieldWrap.hidden = valueType.value !== 'trigger.field';
    literalWrap.hidden = valueType.value !== 'literal';
  };
  triggerEntity.onchange = () => { triggerField.dataset.ready = ''; relationField.dataset.ready = ''; targetField.dataset.ready = ''; sourceField.dataset.ready = ''; refresh(); };
  relationField.onchange = () => { targetField.dataset.ready = ''; refresh(); };
  triggerEvent.onchange = refresh;
  valueType.onchange = refresh;
  refresh();

  const save = h('button', { text: '保存修改', onclick: async () => {
    try {
      const sourceEntity = entities.find((entity) => entity.id === triggerEntity.value);
      const relation = (sourceEntity?.fields || []).find((field) => field.id === relationField.value && field.type === 'relation');
      const targetEntityId = relation?.targetEntity || sourceEntity?.id;
      const nextIntent = {
        supported: true,
        name: name.value.trim() || rule.name,
        summary: `手动修改规则：${name.value.trim() || rule.name}`,
        trigger: triggerEvent.value === 'record.created'
          ? { event: 'record.created', entity: sourceEntity.id }
          : { event: 'record.updated', entity: sourceEntity.id, field: triggerField.value, from: fromValue.value, to: toValue.value },
        target: { entity: targetEntityId, relationField: relation?.id || null, field: targetField.value },
        action: { operation: operation.value, value: valueType.value === 'trigger.field'
          ? { type: 'trigger.field', field: sourceField.value }
          : { type: 'literal', value: literalValue.value } }
      };
      const body = await api(`/api/apps/${encodeURIComponent(appId)}/rules/${encodeURIComponent(rule.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ sourceText: `手动修改：${nextIntent.name}`, businessIntentJson: nextIntent })
      });
      Object.assign(rule, body.rule);
      toast('业务规则已更新');
      onCancel();
    } catch (error) {
      toast(`保存失败：${error.message}`);
    }
  } });
  container.replaceChildren(h('div', { class: 'manual-rule-editor' }, [
    h('div', { class: 'business-rule-detail-head' }, [
      h('button', { class: 'ghost', text: '← 取消修改', onclick: onCancel }),
      save
    ]),
    h('h3', { text: '手动修改业务规则' }),
    h('p', { class: 'muted', text: '修改业务含义后，系统会重新生成并检查执行配置。' }),
    h('div', { class: 'manual-rule-grid' }, [
      h('div', { class: 'field manual-rule-wide' }, [h('label', { text: '规则名称' }), name]),
      h('div', { class: 'field' }, [h('label', { text: '触发方式' }), triggerEvent]),
      h('div', { class: 'field' }, [h('label', { text: '触发表' }), triggerEntity]),
      updatedOnly,
      h('div', { class: 'field' }, [h('label', { text: '影响对象' }), relationField]),
      h('div', { class: 'field' }, [h('label', { text: '目标字段' }), targetField]),
      h('div', { class: 'field' }, [h('label', { text: '操作' }), operation]),
      h('div', { class: 'field' }, [h('label', { text: '值来源' }), valueType]),
      sourceFieldWrap,
      literalWrap
    ])
  ]));
}

async function showRuleDetail(container, appId, app, rule, onBack) {
  const summary = ruleSummary(rule);
  container.replaceChildren(h('div', { class: 'business-rule-detail-loading', text: '正在读取执行记录…' }));
  const [runsBody, statesBody] = await Promise.all([
    api(`/api/apps/${encodeURIComponent(appId)}/rules/${encodeURIComponent(rule.id)}/runs?limit=20`),
    api(`/api/apps/${encodeURIComponent(appId)}/rules/${encodeURIComponent(rule.id)}/states?limit=100`)
  ]);
  const waitingStates = (statesBody.states || []).filter((state) => state.state === 'waiting');
  const toggle = h('button', {
    class: rule.status === 'active' ? 'secondary' : '',
    text: rule.status === 'active' ? '禁用规则' : '启用规则',
    onclick: async () => {
      const nextStatus = rule.status === 'active' ? 'disabled' : 'active';
      const body = await api(`/api/apps/${encodeURIComponent(appId)}/rules/${encodeURIComponent(rule.id)}`, {
        method: 'PATCH', body: JSON.stringify({ status: nextStatus })
      });
      Object.assign(rule, body.rule);
      toast(nextStatus === 'active' ? '规则已启用' : '规则已禁用');
      showRuleDetail(container, appId, app, rule, onBack);
    }
  });
  const mapping = rule.schemaMappingJson || {};
  container.replaceChildren(h('div', { class: 'business-rule-detail' }, [
    h('div', { class: 'business-rule-detail-head' }, [
      h('button', { class: 'ghost', text: '← 返回规则列表', onclick: onBack }),
      h('div', { class: 'row' }, [
        h('button', { class: 'secondary', text: '让 AI 修改', onclick: () => {
          container.closest('.modal-backdrop')?.remove();
          document.dispatchEvent(new CustomEvent('open-ai-rule-edit', { detail: { text: `请修改业务规则「${rule.name}」（规则 ID：${rule.id}）：` } }));
        } }),
        h('button', { class: 'secondary', text: '手动修改', onclick: () => openManualRuleEditor(container, appId, app, rule, () => showRuleDetail(container, appId, app, rule, onBack)) }),
        toggle
      ])
    ]),
    h('div', { class: 'business-rule-title-row' }, [
      h('div', {}, [h('h3', { text: rule.name }), h('p', { class: 'muted', text: rule.sourceText })]),
      h('span', { class: `business-rule-status status-${rule.status}`, text: statusLabel(rule.status) })
    ]),
    h('div', { class: 'business-rule-understanding' }, [
      h('article', {}, [h('b', { text: '什么时候执行？' }), h('p', { text: summary.when })]),
      h('article', {}, [h('b', { text: '执行什么？' }), h('p', { text: summary.then })])
    ]),
    rule.contractJson?.trigger?.type === 'record.created' ? h('p', {
      class: 'muted business-rule-event-policy',
      text: '这条规则会等所需信息填写完整后自动处理一次。之后再修改记录或规则，不会改变已经产生的结果。'
    }) : null,
    h('section', {}, [
      h('h4', { text: '处理范围' }),
      h('div', { class: 'business-rule-mapping' }, [
        h('span', { text: mapping.trigger?.entityName || '来源数据' }),
        h('span', { text: '→' }),
        h('span', { text: `${mapping.target?.entityName || '目标数据'}的“${mapping.target?.fieldName || '目标字段'}”` })
      ])
    ]),
    h('section', {}, [
      h('h4', { text: `等待条件（${waitingStates.length}）` }),
      h('div', { class: 'business-rule-waiting-list' }, waitingStates.length
        ? waitingStates.map((state) => h('div', { class: 'business-rule-waiting-item' }, [
          h('span', { text: '一条待补充记录' }),
          h('span', { text: `等待补充：${state.missingFields.map((field) => field.label).join('、')}` }),
          h('span', { class: 'muted', text: formatTime(state.updatedAt) })
        ]))
        : [h('p', { class: 'muted', text: '没有等待条件的记录。' })])
    ]),
    h('section', {}, [
      h('h4', { text: '最近执行' }),
      h('div', { class: 'business-rule-runs' }, runsBody.runs?.length
        ? runsBody.runs.map((run) => renderRun(run, '', app))
        : [h('p', { class: 'muted', text: '这条规则还没有执行记录。' })])
    ]),
    h('section', {}, [
      h('h4', { text: '高级信息' }),
      jsonDetails('规则理解数据（高级）', rule.businessIntentJson),
      jsonDetails('执行配置（高级）', rule.contractJson)
    ]),
    h('p', { class: 'muted business-rule-created', text: `创建于 ${formatTime(rule.createdAt)} · 更新于 ${formatTime(rule.updatedAt)}` })
  ]));
}

function renderRulesPanel(panel, appId, app, rules) {
  const renderList = () => {
    if (!rules.length) {
      panel.replaceChildren(h('div', { class: 'business-rules-empty' }, [
        h('div', { class: 'business-rules-empty-icon', text: '⚡' }),
        h('h3', { text: '当前应用还没有业务规则' }),
        h('p', { text: '你可以告诉 AI：“订单完成后，把订单金额累计到客户消费”' })
      ]));
      return;
    }
    panel.replaceChildren(h('div', { class: 'business-rules-list' }, rules.map((rule) => {
      const summary = ruleSummary(rule);
      return h('button', { class: 'business-rule-item', onclick: () => showRuleDetail(panel, appId, app, rule, renderList) }, [
        h('div', { class: 'business-rule-item-head' }, [
          h('strong', { text: rule.name }),
          h('span', { class: `business-rule-status status-${rule.status}`, text: statusLabel(rule.status) })
        ]),
        h('p', { text: summary.when }),
        h('p', { class: 'muted', text: summary.then }),
        h('span', { class: 'business-rule-time', text: formatTime(rule.updatedAt) })
      ]);
    })));
  };
  renderList();
}

function renderAiPanel(ai, backdrop) {
  const baseUrl = h('input', { value: ai.baseUrl || 'https://api.openai.com/v1' });
  const apiKey = h('input', { value: '', type: 'password', placeholder: ai.hasApiKey ? '已配置，留空保持不变' : '输入 API Key' });
  const model = h('input', { value: ai.model || 'gpt-4.1-mini' });
  return h('div', {}, [
    h('div', { class: 'form-grid' }, [
      h('div', { class: 'field' }, [h('label', { text: 'API Base URL' }), baseUrl]),
      h('div', { class: 'field' }, [h('label', { text: 'API Key' }), apiKey]),
      h('div', { class: 'field' }, [h('label', { text: 'Model' }), model])
    ]),
    h('div', { class: 'row settings-actions' }, [
      h('button', { text: '保存', onclick: async () => {
        const next = { baseUrl: baseUrl.value, model: model.value };
        if (apiKey.value) next.apiKey = apiKey.value;
        await api('/api/settings', { method: 'PUT', body: JSON.stringify({ ai: next }) });
        backdrop.remove();
        toast('设置已保存');
      } })
    ])
  ]);
}

function createSampleImporter(samples, onImported) {
  const selected = new Set();
  const imported = new Set();
  let busy = false;

  const importIds = async (ids, panel) => {
    if (busy || !ids.length) return;
    busy = true;
    render(panel);
    try {
      const body = await api('/api/samples/import', {
        method: 'POST',
        body: JSON.stringify({ ids })
      });
      ids.forEach((id) => imported.add(id));
      selected.clear();
      onImported();
      toast(`已导入 ${body.imported?.length || ids.length} 个样例`);
    } catch (error) {
      toast(`导入失败：${error.message}`);
    } finally {
      busy = false;
      render(panel);
    }
  };

  const render = (panel) => {
    const allSelected = samples.length > 0 && selected.size === samples.length;
    const selectAll = h('input', {
      type: 'checkbox',
      checked: allSelected ? 'checked' : null,
      onchange: (event) => {
        selected.clear();
        if (event.currentTarget.checked) samples.forEach((sample) => selected.add(sample.id));
        render(panel);
      }
    });
    const cards = samples.map((sample) => {
      const checkbox = h('input', {
        type: 'checkbox',
        checked: selected.has(sample.id) ? 'checked' : null,
        onchange: (event) => {
          if (event.currentTarget.checked) selected.add(sample.id);
          else selected.delete(sample.id);
          render(panel);
        }
      });
      return h('article', { class: 'sample-import-card' }, [
        h('div', { class: 'sample-import-card-select' }, [checkbox]),
        h('div', { class: 'sample-import-card-body' }, [
          h('div', { class: 'sample-import-card-title' }, [
            h('strong', { text: sample.name }),
            h('span', { class: 'category-pill', text: sample.category || '未分类' }),
            imported.has(sample.id) ? h('span', { class: 'sample-imported-badge', text: '本次已导入' }) : null
          ]),
          h('p', { class: 'muted', text: sample.description || '暂无介绍' }),
          h('div', { class: 'sample-import-meta' }, [
            h('span', { text: `${sample.entityCount} 张表` }),
            h('span', { text: `${sample.recordCount} 条数据` }),
            h('span', { text: `${sample.ruleCount} 条业务规则` })
          ])
        ]),
        h('button', {
          class: 'secondary sample-import-one',
          text: busy ? '导入中…' : '导入',
          disabled: busy ? 'disabled' : null,
          onclick: () => importIds([sample.id], panel)
        })
      ]);
    });
    panel.replaceChildren(h('div', { class: 'sample-import-panel' }, [
      h('div', { class: 'sample-import-toolbar' }, [
        h('label', { class: 'sample-select-all' }, [selectAll, h('span', { text: '全选' })]),
        h('span', { class: 'muted', text: `共 ${samples.length} 个样例，已选择 ${selected.size} 个` }),
        h('button', {
          text: busy ? '导入中…' : `导入选中${selected.size ? ` (${selected.size})` : ''}`,
          disabled: busy || !selected.size ? 'disabled' : null,
          onclick: () => importIds([...selected], panel)
        })
      ]),
      samples.length ? h('div', { class: 'sample-import-list' }, cards) : h('div', { class: 'business-rules-empty' }, [
        h('h3', { text: '样例库为空' }),
        h('p', { class: 'muted', text: '当前还没有可导入的样例。' })
      ])
    ]));
  };
  return { render };
}

export async function openSettingsModal(appId = '', initialTab = 'rules') {
  const [settings, rulesBody, runsBody, appBody, samplesBody] = await Promise.all([
    appId ? Promise.resolve({ ai: {} }) : api('/api/settings'),
    appId ? api(`/api/apps/${encodeURIComponent(appId)}/rules`) : Promise.resolve({ rules: [] }),
    appId ? api(`/api/apps/${encodeURIComponent(appId)}/rule-runs?limit=100`) : Promise.resolve({ runs: [] }),
    appId ? api(`/api/apps/${encodeURIComponent(appId)}`) : Promise.resolve({ app: null }),
    appId ? Promise.resolve({ samples: [] }) : api('/api/samples')
  ]);
  let activeTab = appId ? (initialTab === 'runs' ? 'runs' : 'rules') : (initialTab === 'samples' ? 'samples' : 'ai');
  let samplesImported = false;
  const content = h('div', { class: 'settings-modal-content' });
  const tabs = h('div', { class: 'settings-tabs' });
  const backdrop = h('div', { class: 'modal-backdrop' });
  const close = async () => {
    backdrop.remove();
    if (samplesImported) await loadApps();
  };
  const sampleImporter = createSampleImporter(samplesBody.samples || [], () => { samplesImported = true; });
  const render = () => {
    tabs.querySelectorAll('button').forEach((button) => button.classList.toggle('active', button.dataset.tab === activeTab));
    if (activeTab === 'rules') renderRulesPanel(content, appId, appBody.app, rulesBody.rules || []);
    else if (activeTab === 'runs') renderAllRunsPanel(content, rulesBody.rules || [], runsBody.runs || [], appBody.app);
    else if (activeTab === 'samples') sampleImporter.render(content);
    else content.replaceChildren(renderAiPanel(settings.ai || {}, backdrop));
  };
  const tab = (id, text) => h('button', { class: 'settings-tab', text, 'data-tab': id, onclick: () => { activeTab = id; render(); } });
  if (appId) {
    tabs.append(tab('rules', `业务规则 ${rulesBody.rules?.length ? `(${rulesBody.rules.length})` : ''}`));
    tabs.append(tab('runs', `执行记录 ${runsBody.runs?.length ? `(${runsBody.runs.length})` : ''}`));
  } else {
    tabs.append(tab('ai', 'AI 设置'));
    tabs.append(tab('samples', `样例导入 (${samplesBody.samples?.length || 0})`));
  }
  backdrop.append(h('div', { class: 'modal app-settings-modal' }, [
    h('div', { class: 'toolbar app-settings-head' }, [h('h3', { text: appId ? '应用设置' : '系统设置' }), h('button', { class: 'ghost', text: '关闭', onclick: close })]),
    tabs,
    content
  ]));
  document.body.append(backdrop);
  render();
}
