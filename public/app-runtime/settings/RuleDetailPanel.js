import { h } from '../../common/dom.js';
import { api } from '../../common/api.js';
import { toast } from '../../common/toast.js';
import { getClientRuntimeSettings } from '../../common/runtime-settings-store.js';
import { formatTime, jsonDetails, ruleSummary, statusLabel } from './rule-formatters.js';
import { openManualRuleEditor } from './ManualRuleEditor.js';
import { renderRun } from './RuleRunsPanel.js';

export async function showRuleDetail(container, appId, app, rule, onBack) {
  const summary = ruleSummary(rule);
  container.replaceChildren(h('div', { class: 'business-rule-detail-loading', text: '正在读取执行记录…' }));
  const [runsBody, statesBody] = await Promise.all([
    api(`/api/apps/${encodeURIComponent(appId)}/rules/${encodeURIComponent(rule.id)}/runs?limit=${getClientRuntimeSettings().ruleRunDetailLimit}`),
    api(`/api/apps/${encodeURIComponent(appId)}/rules/${encodeURIComponent(rule.id)}/states?limit=${getClientRuntimeSettings().ruleStateDisplayLimit}`)
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
