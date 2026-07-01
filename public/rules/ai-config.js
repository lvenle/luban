import { h } from '../common/dom.js';
import { toast } from '../common/toast.js';
import { ruleRepository } from './rule-repository.js';
import { renderRuleSimulation } from './simulation-view.js';

const DEFAULT_RULE = '出库确认后自动扣库存，库存不足不能出库。';
const EXAMPLES = [
  '出库确认后自动扣库存，库存不足不能出库',
  '入库确认后自动增加库存',
  '订单金额超过5000元时需要主管审批'
];

const CONTRACT = {
  id: 'stock_out_confirm_decrease_inventory',
  name: '出库确认后自动扣库存',
  trigger: { type: 'record.updated', entity: 'stock_out', field: 'status', from: 'draft', to: 'confirmed' },
  check: { left: 'products.stock', operator: '>=', right: 'stock_out_items.quantity' },
  then: { type: 'inventory.adjust', operation: 'decrease', target: 'products.stock', value: 'stock_out_items.quantity' },
  else: { type: 'block', message: '库存不足，无法出库' },
  steps: [
    { id: 'read_items', type: 'read.records', entity: 'stock_out_items', where: { stock_out_id: '{{trigger.record.id}}' }, output: 'items' },
    { id: 'group_items', type: 'aggregate.sum', input: 'items', groupBy: 'product_id', sum: 'quantity', output: 'groupedItems' },
    { id: 'check_stock', type: 'condition', scope: 'each groupedItems', left: 'products.stock', operator: '>=', right: 'groupedItems.quantity', then: ['decrease_stock'], else: ['block_stock_out'] },
    { id: 'decrease_stock', type: 'update.field', entity: 'products', record: '{{groupedItems.product_id}}', field: 'stock', operation: 'decrement', value: '{{groupedItems.quantity}}' },
    { id: 'block_stock_out', type: 'block', message: '库存不足，无法出库' },
    { id: 'write_log', type: 'log.run' }
  ],
  idempotency: { key: '{{rule.id}}:{{trigger.entity}}:{{trigger.record.id}}' }
};

const BUSINESS_INTENT = {
  trigger: { summary: '出库确认时', entity: '出库单', condition: '状态从草稿变为已确认' },
  check: { summary: '校验商品库存', expression: '商品.库存 >= 出库明细.出库数量' },
  action: { success: '扣减商品库存', failure: '阻止出库，并提示“库存不足，无法出库”' }
};

const SCHEMA_MAPPING = {
  entities: {
    products: { label: '商品', stock: 'products.stock' },
    stock_out: { label: '出库单', status: 'stock_out.status' },
    stock_out_items: { label: '出库明细', productId: 'stock_out_items.product_id', quantity: 'stock_out_items.quantity' }
  },
  relations: [
    'stock_out_items.stock_out_id = stock_out.id',
    'stock_out_items.product_id = products.id'
  ]
};

function token(text) {
  return h('span', { class: 'rule-token', text });
}

function understandingCard(kind, eyebrow, title, content) {
  return h('article', { class: `rule-understanding-card ${kind}` }, [
    h('div', { class: 'rule-card-icon', 'aria-hidden': 'true', text: kind === 'trigger' ? '◷' : kind === 'check' ? '✓' : '⚡' }),
    h('p', { class: 'rule-card-eyebrow', text: eyebrow }),
    h('h3', { text: title }),
    content
  ]);
}

function mappingRow(label, technical, business) {
  return h('div', { class: 'mapping-row' }, [
    h('span', { class: 'mapping-label', text: label }),
    h('code', { text: technical }),
    h('span', { class: 'mapping-arrow', 'aria-hidden': 'true', text: '→' }),
    h('span', { class: 'mapping-business', text: business })
  ]);
}

function renderUnderstanding() {
  return h('section', { class: 'rule-section', 'aria-labelledby': 'understanding-title' }, [
    h('div', { class: 'rule-section-heading' }, [
      h('div', {}, [h('span', { class: 'step-number', text: '2' }), h('h2', { id: 'understanding-title', text: 'AI 理解结果' })]),
      h('span', { class: 'mock-badge subtle', text: 'AI MOCK' })
    ]),
    h('div', { class: 'understanding-grid' }, [
      understandingCard('trigger', '什么时候执行？', '出库确认时', h('div', { class: 'token-line' }, [token('出库单'), token('状态'), h('span', { text: '变为' }), token('已确认')])),
      understandingCard('check', '需要检查什么？', '校验商品库存', h('div', { class: 'token-line' }, [token('商品.库存'), token('大于等于'), token('出库明细.出库数量')])),
      understandingCard('action', '要做什么？', '根据库存决定', h('div', { class: 'action-lines' }, [
        h('p', {}, [h('b', { text: '库存足够：' }), h('span', { text: '扣减商品库存' })]),
        h('p', {}, [h('b', { text: '库存不足：' }), h('span', { text: '阻止出库，并提示“库存不足，无法出库”' })])
      ]))
    ])
  ]);
}

function renderMapping() {
  return h('section', { class: 'rule-section', 'aria-labelledby': 'mapping-title' }, [
    h('div', { class: 'rule-section-heading' }, [
      h('div', {}, [h('span', { class: 'step-number', text: '3' }), h('h2', { id: 'mapping-title', text: 'Schema Mapping' })]),
      h('span', { class: 'mock-badge', text: 'MOCK 匹配结果' })
    ]),
    h('p', { class: 'rule-section-note', text: 'AI 根据业务描述自动匹配到以下表、字段与关联关系。当前为静态 Mock，不会读取真实数据库。' }),
    h('div', { class: 'mapping-grid' }, [
      h('article', { class: 'mapping-card' }, [h('h3', { text: '商品表' }), mappingRow('表', 'products', '商品'), mappingRow('库存字段', 'products.stock', '商品.库存')]),
      h('article', { class: 'mapping-card' }, [h('h3', { text: '出库单' }), mappingRow('表', 'stock_out', '出库单'), mappingRow('状态字段', 'stock_out.status', '出库单.状态')]),
      h('article', { class: 'mapping-card wide' }, [h('h3', { text: '出库明细' }), mappingRow('表', 'stock_out_items', '出库明细'), mappingRow('商品字段', 'stock_out_items.product_id', '出库明细.商品'), mappingRow('数量字段', 'stock_out_items.quantity', '出库明细.出库数量')]),
      h('article', { class: 'mapping-card relation wide' }, [
        h('h3', { text: '关联关系' }),
        h('code', { text: 'stock_out_items.stock_out_id = stock_out.id' }),
        h('code', { text: 'stock_out_items.product_id = products.id' })
      ])
    ])
  ]);
}

function renderResults(sourceText) {
  const saveButton = h('button', { type: 'button', class: 'save-rule-button', text: '保存规则' });
  const statusSelect = h('select', { class: 'save-rule-status', 'aria-label': '保存状态' }, [
    h('option', { value: 'active', text: '保存并启用' }),
    h('option', { value: 'draft', text: '保存为草稿' })
  ]);
  saveButton.addEventListener('click', () => {
    try {
      const rule = ruleRepository.createRule({
        name: CONTRACT.name,
        description: 'AI 配置生成的库存业务规则',
        status: statusSelect.value,
        sourceText,
        businessIntentJson: BUSINESS_INTENT,
        schemaMappingJson: SCHEMA_MAPPING,
        contractJson: CONTRACT
      });
      saveButton.textContent = '✓ 规则已保存';
      saveButton.disabled = true;
      statusSelect.disabled = true;
      const success = h('div', { class: 'rule-save-success', role: 'status' }, [
        h('strong', { text: '规则已保存' }),
        h('a', { href: `/rules/${encodeURIComponent(rule.id)}`, text: '查看规则详情' }),
        h('a', { href: '/rules', text: '查看规则列表' })
      ]);
      saveButton.closest('.save-rule-area').after(success);
      toast('规则已保存');
    } catch (error) {
      toast(`保存失败：${error.message}`);
    }
  });
  return h('div', { class: 'rule-results' }, [
    renderUnderstanding(),
    renderMapping(),
    renderRuleSimulation(CONTRACT, { stepNumber: '4', note: '切换场景查看完整执行步骤和 before / after。模拟结果符合预期后，再保存规则。' }),
    h('details', { class: 'contract-panel' }, [
      h('summary', {}, [h('span', {}, [h('b', { text: '高级模式' }), h('span', { text: ' / 查看 Contract' })]), h('span', { class: 'contract-chevron', 'aria-hidden': 'true', text: '⌄' })]),
      h('div', { class: 'contract-content' }, [
        h('div', { class: 'contract-note' }, [h('span', { class: 'mock-badge', text: 'MOCK CONTRACT' }), h('span', { text: '仅用于预览规则结构，尚未接入执行引擎。' })]),
        h('pre', {}, [h('code', { text: JSON.stringify(CONTRACT, null, 2) })])
      ])
    ]),
    h('div', { class: 'save-rule-area' }, [
      h('div', {}, [h('strong', { text: '确认 AI 的理解符合预期？' }), h('span', { text: '规则将保存到当前浏览器，不会执行或扣减真实库存。' })]),
      h('div', { class: 'save-rule-actions' }, [statusSelect, saveButton])
    ])
  ]);
}

export function renderAiRuleConfig(root) {
  document.title = 'AI 配置业务规则 · 鲁班AI系统';
  root.innerHTML = '';
  const textarea = h('textarea', { id: 'rule-prompt', rows: '4', 'aria-describedby': 'rule-input-help' });
  textarea.value = DEFAULT_RULE;
  const output = h('div', { class: 'rule-output', 'aria-live': 'polite' });
  const configureButton = h('button', { type: 'button', class: 'configure-rule-button', text: '✦ AI 帮我配置' });
  configureButton.addEventListener('click', () => {
    if (!textarea.value.trim()) {
      textarea.focus();
      toast('请先描述你想配置的业务规则。');
      return;
    }
    configureButton.disabled = true;
    configureButton.textContent = '正在理解规则…';
    window.setTimeout(() => {
      output.replaceChildren(renderResults(textarea.value.trim()));
      configureButton.disabled = false;
      configureButton.textContent = '✦ 重新配置';
      output.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 350);
  });

  root.append(h('div', { class: 'rule-config-page' }, [
    h('header', { class: 'rule-config-topbar' }, [
      h('a', { class: 'rule-brand', href: '/', 'aria-label': '返回鲁班首页' }, [h('img', { src: '/images/logo.png', alt: '' }), h('span', { text: '鲁班AI系统' })]),
      h('div', { class: 'rule-topbar-context' }, [h('span', { text: '业务规则' }), h('b', { text: 'AI 配置' })]),
      h('a', { class: 'rule-back-link', href: '/', text: '返回首页' })
    ]),
    h('main', { class: 'rule-config-main' }, [
      h('section', { class: 'rule-config-intro' }, [
        h('span', { class: 'rule-kicker', text: 'AI RULE CONFIG · MOCK' }),
        h('h1', { text: '用一句话，配置业务自动化规则' }),
        h('p', { text: '描述业务场景，AI 将帮你理解触发条件、数据检查和执行动作，并保存生成的规则 Contract。' })
      ]),
      h('section', { class: 'rule-input-card', 'aria-labelledby': 'rule-input-title' }, [
        h('div', { class: 'rule-section-heading' }, [h('div', {}, [h('span', { class: 'step-number', text: '1' }), h('h2', { id: 'rule-input-title', text: '你想让系统自动完成什么？' })])]),
        textarea,
        h('div', { class: 'rule-input-footer' }, [
          h('span', { id: 'rule-input-help', class: 'muted', text: '试试示例' }),
          h('div', { class: 'rule-examples' }, EXAMPLES.map((example) => h('button', { type: 'button', class: 'rule-example-chip', text: example, onclick: () => { textarea.value = example; textarea.focus(); } }))),
          configureButton
        ])
      ]),
      output
    ]),
    h('footer', { class: 'rule-config-footer', text: 'M4 · Contract Interpreter · 未接入真实 AI' })
  ]));
}
