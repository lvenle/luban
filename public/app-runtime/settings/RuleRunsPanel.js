import { h } from '../../common/dom.js';
import { humanizeMessage } from '../../common/messages.js';
import { formatRuleChanges } from '../RuleFeedback.js';
import { formatTime, statusLabel } from './rule-formatters.js';

export function renderRun(run, ruleName = '', app = null) {
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

export function renderAllRunsPanel(panel, rules, runs, app) {
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
