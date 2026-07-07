import { h } from '../../common/dom.js';
import { formatTime, ruleSummary, statusLabel } from './rule-formatters.js';
import { showRuleDetail } from './RuleDetailPanel.js';

export function renderRulesPanel(panel, appId, app, rules) {
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
