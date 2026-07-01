import { h } from '../common/dom.js';
import { INVENTORY_SAMPLE_DATA, simulateRule } from './rule-simulator.js';

function resultSummary(result) {
  if (result.status === 'error') {
    return h('div', { class: 'simulator-error', role: 'alert' }, [
      h('strong', { text: result.title }),
      h('span', { text: result.summary })
    ]);
  }
  const success = result.status === 'success';
  return h('div', { class: `simulator-summary ${result.status}` }, [
    h('div', { class: 'simulation-product' }, [
      h('div', { class: 'product-avatar', 'aria-hidden': 'true', text: result.product.name.slice(0, 2) }),
      h('div', {}, [h('span', { class: 'muted', text: '商品' }), h('strong', { text: result.product.name })])
    ]),
    h('div', { class: 'simulation-metrics' }, [
      h('div', {}, [h('span', { text: '当前库存' }), h('strong', { text: String(result.currentStock) })]),
      h('span', { class: 'metric-symbol', text: success ? '−' : '<' }),
      h('div', {}, [h('span', { text: '出库数量' }), h('strong', { text: String(result.quantity) })]),
      success ? h('span', { class: 'metric-symbol', text: '=' }) : null,
      success ? h('div', {}, [h('span', { text: '执行后库存' }), h('strong', { text: String(result.afterStock) })]) : null
    ]),
    h('div', { class: 'simulation-verdict' }, [
      h('span', { class: 'verdict-icon', 'aria-hidden': 'true', text: success ? '✓' : '!' }),
      h('div', {}, [h('strong', { text: result.title }), h('span', { text: result.summary })])
    ])
  ]);
}

function steps(result) {
  return h('ol', { class: 'simulator-steps', 'aria-label': '模拟执行步骤' }, result.steps.map((step) => h('li', { class: step.status }, [
    h('span', { class: 'simulator-step-marker', 'aria-hidden': 'true', text: step.status === 'success' ? '✓' : step.status === 'blocked' ? '!' : '×' }),
    h('div', {}, [h('strong', { text: step.name }), h('span', { text: step.detail })])
  ])));
}

function comparison(result) {
  if (!result.before) return null;
  return h('details', { class: 'simulator-comparison' }, [
    h('summary', { text: '查看 before / after 数据对比' }),
    h('div', {}, [
      h('section', {}, [h('h4', { text: 'Before' }), h('pre', {}, [h('code', { text: JSON.stringify(result.before, null, 2) })])]),
      h('section', {}, [h('h4', { text: 'After' }), h('pre', {}, [h('code', { text: JSON.stringify(result.after ?? result.before, null, 2) })])])
    ])
  ]);
}

function resultPanel(result) {
  return h('div', { class: `simulator-panel ${result.status}`, role: 'tabpanel' }, [
    resultSummary(result),
    h('div', { class: 'simulator-step-area' }, [h('h3', { text: '执行步骤' }), steps(result)]),
    comparison(result)
  ]);
}

export function renderRuleSimulation(contractJson, { stepNumber = '', note = '使用内置样例数据验证规则结果，不会读取或修改真实库存。' } = {}) {
  const scenarios = {
    enough: simulateRule(contractJson, INVENTORY_SAMPLE_DATA.enough),
    shortage: simulateRule(contractJson, INVENTORY_SAMPLE_DATA.shortage)
  };
  const content = h('div');
  const tabs = h('div', { class: 'simulation-tabs', role: 'tablist', 'aria-label': '模拟场景' });
  const select = (kind) => {
    tabs.querySelectorAll('button').forEach((button) => {
      const selected = button.dataset.kind === kind;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
    });
    content.replaceChildren(resultPanel(scenarios[kind]));
  };
  [['enough', '库存充足模拟'], ['shortage', '库存不足模拟']].forEach(([kind, label]) => {
    const selected = kind === 'enough';
    const button = h('button', { type: 'button', role: 'tab', class: selected ? 'active' : '', 'aria-selected': String(selected), text: label, onclick: () => select(kind) });
    button.dataset.kind = kind;
    tabs.append(button);
  });
  content.append(resultPanel(scenarios.enough));
  return h('section', { class: 'rule-section rule-simulator', 'aria-labelledby': 'simulation-title' }, [
    h('div', { class: 'rule-section-heading' }, [
      h('div', {}, [stepNumber ? h('span', { class: 'step-number', text: stepNumber }) : null, h('h2', { id: 'simulation-title', text: '模拟执行' })]),
      h('span', { class: 'mock-badge', text: '内置样例 · 不改库存' })
    ]),
    h('p', { class: 'rule-section-note', text: note }),
    tabs,
    content
  ]);
}
