const REQUIRED_CONTRACT_FIELDS = ['trigger', 'check', 'then', 'else'];

export const INVENTORY_SAMPLE_DATA = Object.freeze({
  enough: {
    product: { id: 'p1', name: 'iPhone 15', stock: 10 },
    stockOut: { id: 'so1', status: 'confirmed' },
    stockOutItems: [{ id: 'item1', stock_out_id: 'so1', product_id: 'p1', quantity: 2 }]
  },
  shortage: {
    product: { id: 'p2', name: 'AirPods Pro', stock: 0 },
    stockOut: { id: 'so2', status: 'confirmed' },
    stockOutItems: [{ id: 'item2', stock_out_id: 'so2', product_id: 'p2', quantity: 1 }]
  }
});

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function errorResult(detail, sampleData) {
  return {
    status: 'error',
    title: '无法模拟',
    summary: detail,
    steps: [{ name: '校验模拟输入', status: 'error', detail }],
    before: clone(sampleData)
  };
}

function validContract(contractJson) {
  return contractJson && typeof contractJson === 'object' && !Array.isArray(contractJson)
    && REQUIRED_CONTRACT_FIELDS.every((field) => contractJson[field] && typeof contractJson[field] === 'object' && !Array.isArray(contractJson[field]));
}

export class RuleSimulator {
  simulateRule(contractJson, sampleData) {
    if (!validContract(contractJson)) {
      return errorResult('Contract 缺少必要字段，无法模拟', sampleData);
    }

    const product = sampleData?.product;
    const stockOut = sampleData?.stockOut;
    const items = sampleData?.stockOutItems;
    const stock = Number(product?.stock);
    if (!product?.id || !product?.name || !stockOut?.id || !Array.isArray(items) || !Number.isFinite(stock)) {
      return errorResult('样例数据不完整，无法模拟', sampleData);
    }

    const matchedItems = items.filter((item) => item?.stock_out_id === stockOut.id && item?.product_id === product.id);
    const quantities = matchedItems.map((item) => Number(item.quantity));
    if (!matchedItems.length || quantities.some((quantity) => !Number.isFinite(quantity) || quantity < 0)) {
      return errorResult('样例出库明细无效，无法模拟', sampleData);
    }

    const quantity = quantities.reduce((total, value) => total + value, 0);
    const enough = stock >= quantity;
    const afterStock = enough ? stock - quantity : stock;
    const blockMessage = String(contractJson.else.message || '库存不足，无法出库');
    const expectedStatus = contractJson.trigger.to || 'confirmed';
    const triggerLabel = expectedStatus === 'confirmed' ? '已确认' : expectedStatus;
    const commonSteps = [
      { name: '触发规则', status: 'success', detail: `出库单状态变为${triggerLabel}` },
      { name: '读取出库明细', status: 'success', detail: `读取到 ${matchedItems.length} 条明细` },
      { name: '按商品汇总', status: 'success', detail: `${product.name} 汇总出库数量 ${quantity}` },
      { name: '检查库存', status: enough ? 'success' : 'blocked', detail: `库存 ${stock} ${enough ? '>=' : '<'} 出库数量 ${quantity}` }
    ];
    const finalStep = enough
      ? { name: '模拟扣减库存', status: 'success', detail: `库存从 ${stock} 变为 ${afterStock}` }
      : { name: '阻止出库', status: 'blocked', detail: blockMessage };

    return {
      status: enough ? 'success' : 'blocked',
      title: enough ? '允许出库' : '阻止出库',
      summary: enough ? `库存校验通过，模拟扣减后剩余 ${afterStock} 件` : blockMessage,
      product: { id: product.id, name: product.name },
      currentStock: stock,
      quantity,
      afterStock: enough ? afterStock : undefined,
      steps: [...commonSteps, finalStep],
      before: clone(sampleData),
      after: {
        ...clone(sampleData),
        product: { ...clone(product), stock: afterStock }
      }
    };
  }
}

export const ruleSimulator = new RuleSimulator();

export function simulateRule(contractJson, sampleData) {
  return ruleSimulator.simulateRule(contractJson, sampleData);
}
