import { h } from '../common/dom.js';
import { toast } from '../common/toast.js';
import { api } from '../common/api.js';
import { ruleRepository } from './rule-repository.js';
import { renderRuleSimulation } from './simulation-view.js';

const STATUS_LABELS = { draft: '草稿', active: '已启用', disabled: '已停用' };
const EXECUTION_RESULT_LABELS = {
  success: '业务处理已完成',
  blocked: '业务条件未满足，本次没有处理',
  failed: '业务处理没有完成，请查看详情',
  skipped: '本次操作无需执行这条规则'
};

function formatDate(value, dateOnly = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('zh-CN', dateOnly ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function header(context) {
  return h('header', { class: 'rule-config-topbar' }, [
    h('a', { class: 'rule-brand', href: '/', 'aria-label': '返回鲁班首页' }, [h('img', { src: '/images/logo.png', alt: '' }), h('span', { text: '鲁班AI系统' })]),
    h('div', { class: 'rule-topbar-context' }, [h('span', { text: '业务规则' }), h('b', { text: context })]),
    h('a', { class: 'rule-back-link', href: '/rules/ai-config', text: 'AI 配置规则' })
  ]);
}

function statusBadge(status) {
  return h('span', { class: `rule-status ${status}`, text: STATUS_LABELS[status] || status });
}

function emptyState() {
  return h('div', { class: 'rules-empty' }, [
    h('div', { class: 'rules-empty-icon', text: '⌁' }),
    h('h2', { text: '还没有保存规则' }),
    h('p', { text: '用一句话描述业务自动化需求，确认 AI 的理解后即可保存。' }),
    h('a', { class: 'rules-primary-link', href: '/rules/ai-config', text: '配置第一条规则' })
  ]);
}

export function renderRuleList(root) {
  document.title = '规则列表 · 鲁班AI系统';
  const rules = ruleRepository.listRules();
  const body = rules.length ? h('div', { class: 'rules-table-wrap' }, [
    h('table', { class: 'rules-table' }, [
      h('thead', {}, [h('tr', {}, ['规则名称', '状态', '来源描述', '创建时间', '更新时间', '操作'].map((text) => h('th', { text })))]),
      h('tbody', {}, rules.map((rule) => h('tr', {}, [
        h('td', {}, [h('strong', { text: rule.name })]),
        h('td', {}, [statusBadge(rule.status)]),
        h('td', { class: 'rule-source-cell', title: rule.sourceText, text: rule.sourceText }),
        h('td', { text: formatDate(rule.createdAt, true) }),
        h('td', { text: formatDate(rule.updatedAt, true) }),
        h('td', {}, [h('a', { class: 'rule-view-link', href: `/rules/${encodeURIComponent(rule.id)}`, text: '查看' })])
      ])))
    ])
  ]) : emptyState();
  root.replaceChildren(h('div', { class: 'rule-config-page' }, [
    header('规则列表'),
    h('main', { class: 'rules-main' }, [
      h('div', { class: 'rules-title-row' }, [
        h('div', {}, [h('span', { class: 'rule-kicker', text: 'RULE CONTRACTS' }), h('h1', { text: '规则列表' }), h('p', { text: `共 ${rules.length} 条规则。可使用内置样例模拟，不会执行真实规则。` })]),
        h('a', { class: 'rules-primary-link', href: '/rules/ai-config', text: '＋ 新建规则' })
      ]),
      body
    ]),
    h('footer', { class: 'rule-config-footer', text: 'M4 · Contract Interpreter · 仅支持白名单 Contract Steps' })
  ]));
}

function jsonSection(title, value, className = '') {
  return h('section', { class: `rule-detail-section ${className}` }, [
    h('h2', { text: title }),
    h('pre', {}, [h('code', { text: JSON.stringify(value, null, 2) })])
  ]);
}

function renderRuleRuns(runs, ruleName = '') {
  if (!runs.length) return h('div', { class: 'rule-runs-empty', text: '当前应用还没有这条规则的执行日志。' });
  return h('div', { class: 'rule-runs-list' }, runs.map((run) => h('details', { class: `rule-run-item ${run.status}` }, [
    h('summary', {}, [
      statusBadge(run.status),
      h('strong', { text: new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(run.createdAt)) }),
      h('span', { text: `${ruleName || '规则'} · ${run.ruleId}` })
    ]),
    h('div', { class: 'rule-run-body' }, [
      h('dl', {}, [
        h('div', {}, [h('dt', { text: '来源对象' }), h('dd', { text: run.sourceEntity })]),
        h('div', {}, [h('dt', { text: '来源记录' }), h('dd', { text: run.sourceRecordId })]),
        h('div', {}, [h('dt', { text: '规则名称 / ruleId' }), h('dd', { text: `${ruleName || '规则'} / ${run.ruleId}` })]),
        h('div', {}, [h('dt', { text: 'idempotencyKey' }), h('dd', {}, [h('code', { text: run.idempotencyKey })])]),
        run.errorMessage ? h('div', {}, [h('dt', { text: '错误信息' }), h('dd', { text: run.errorMessage })]) : null
      ]),
      h('h3', { text: '执行步骤' }),
      h('ol', { class: 'rule-run-steps' }, (run.stepsJson || []).map((step) => h('li', { class: step.status }, [
        h('strong', { text: `${step.stepId} · ${step.type}` }),
        h('span', { text: step.message })
      ])))
    ])
  ])));
}

function renderRuntimePanel(rule) {
  const appInput = h('input', { type: 'text', placeholder: '应用 ID，例如 app_xxx', 'aria-label': '应用 ID' });
  const recordInput = h('input', { type: 'text', placeholder: '来源记录 ID，例如 rec_xxx', 'aria-label': '来源记录 ID' });
  const output = h('div', { class: 'rule-runs-output' }, [h('div', { class: 'rule-runs-empty', text: '输入应用 ID 后可加载执行日志。' })]);
  const loadButton = h('button', { type: 'button', class: 'secondary', text: '加载执行日志' });
  const executeButton = h('button', { type: 'button', class: 'runtime-execute-button', text: '模拟触发真实执行' });

  const loadRuns = async () => {
    const appId = appInput.value.trim();
    if (!appId) { appInput.focus(); toast('请填写应用 ID'); return; }
    const body = await api(`/api/apps/${encodeURIComponent(appId)}/rule-runs?ruleId=${encodeURIComponent(rule.id)}`);
    output.replaceChildren(renderRuleRuns(body.runs || [], rule.name));
  };
  loadButton.addEventListener('click', () => loadRuns().catch((error) => toast(error.message)));
  executeButton.addEventListener('click', async () => {
    const appId = appInput.value.trim();
    const recordId = recordInput.value.trim();
    if (!appId || !recordId) { toast('请填写应用 ID 和来源记录 ID'); return; }
    executeButton.disabled = true;
    executeButton.textContent = '正在执行…';
    try {
      const trigger = rule.contractJson?.trigger || {};
      const result = await api(`/api/apps/${encodeURIComponent(appId)}/rules/execute`, {
        method: 'POST',
        body: JSON.stringify({
          rule: { id: rule.id, status: rule.status, contractJson: rule.contractJson },
          event: {
            type: 'record.updated', entity: trigger.entity, recordId,
            before: { [trigger.field]: trigger.from }, after: { [trigger.field]: trigger.to }
          }
        })
      });
      toast(EXECUTION_RESULT_LABELS[result.status] || '业务规则处理完成，请查看详情。');
      await loadRuns();
    } catch (error) {
      toast(error.message);
    } finally {
      executeButton.disabled = false;
      executeButton.textContent = '模拟触发真实执行';
    }
  });

  return h('section', { class: 'rule-detail-section runtime-panel' }, [
    h('div', { class: 'runtime-panel-heading' }, [
      h('div', {}, [h('span', { class: 'runtime-dev-badge', text: '开发调试入口' }), h('h2', { text: '真实执行日志 / Rule Runs' })]),
      h('p', { text: '此入口会调用通用 Contract Interpreter 并真实修改匹配数据。请仅对测试应用使用。' })
    ]),
    h('div', { class: 'runtime-controls' }, [appInput, recordInput, loadButton, executeButton]),
    output
  ]);
}

export function renderRuleDetail(root, id) {
  const rule = ruleRepository.getRule(id);
  document.title = rule ? `${rule.name} · 规则详情` : '规则不存在 · 鲁班AI系统';
  if (!rule) {
    root.replaceChildren(h('div', { class: 'rule-config-page' }, [header('规则详情'), h('main', { class: 'rules-main' }, [h('div', { class: 'rules-empty' }, [h('h1', { text: '未找到这条规则' }), h('p', { text: '规则可能已被删除，或当前链接无效。' }), h('a', { class: 'rules-primary-link', href: '/rules', text: '返回规则列表' })])])]));
    return;
  }
  const statusSelect = h('select', { class: 'rule-status-select', 'aria-label': '规则状态' }, Object.entries(STATUS_LABELS).map(([value, label]) => h('option', { value, text: label })));
  statusSelect.value = rule.status;
  statusSelect.addEventListener('change', () => {
    ruleRepository.updateRule(rule.id, { status: statusSelect.value });
    toast('规则状态已更新');
    renderRuleDetail(root, rule.id);
  });
  root.replaceChildren(h('div', { class: 'rule-config-page' }, [
    header('规则详情'),
    h('main', { class: 'rules-main detail' }, [
      h('a', { class: 'rules-breadcrumb', href: '/rules', text: '← 返回规则列表' }),
      h('section', { class: 'rule-detail-hero' }, [
        h('div', {}, [h('span', { class: 'rule-kicker', text: 'RULE DETAIL' }), h('h1', { text: rule.name }), rule.description ? h('p', { text: rule.description }) : null]),
        h('label', { class: 'rule-status-control' }, [h('span', { text: '规则状态' }), statusSelect])
      ]),
      h('div', { class: 'rule-detail-meta' }, [
        h('div', {}, [h('span', { text: '创建时间' }), h('strong', { text: formatDate(rule.createdAt) })]),
        h('div', {}, [h('span', { text: '更新时间' }), h('strong', { text: formatDate(rule.updatedAt) })])
      ]),
      h('section', { class: 'rule-detail-section source' }, [h('h2', { text: '用户原始输入' }), h('blockquote', { text: rule.sourceText })]),
      renderRuleSimulation(rule.contractJson, { note: '使用内置库存充足 / 不足样例生成模拟步骤。仅计算结果，不读取或修改真实库存。' }),
      renderRuntimePanel(rule),
      jsonSection('AI 理解结果', rule.businessIntentJson),
      jsonSection('Schema Mapping', rule.schemaMappingJson),
      jsonSection('Contract JSON', rule.contractJson, 'contract')
    ]),
    h('footer', { class: 'rule-config-footer', text: 'M4 · Generic Contract Interpreter · 非库存专用 Runtime' })
  ]));
}
