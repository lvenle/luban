import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { resetDbForTests } from '../src/storage/db.js';
import { createAppFromPackage } from '../src/models/app.js';
import { createRecord } from '../src/models/record.js';
import { createAppServer } from '../src/server.js';
import { createBudgetPackage } from '../src/ai/samplePackages.js';

const port = Number(process.env.PORT || 5174);
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;
delete process.env.SUPABASE_BUCKET;
const dbPath = join(process.cwd(), 'data', 'rule-acceptance.sqlite');
rmSync(dbPath, { force: true });
resetDbForTests(dbPath);

const pkg = createBudgetPackage();
pkg.manifest.id = 'rule-acceptance';
pkg.manifest.name = '规则端到端验收数据';
pkg.schema.entities = [
  { id: 'products', name: '商品', fields: [{ id: 'name', label: '名称', type: 'text' }, { id: 'stock', label: '库存', type: 'number' }] },
  { id: 'stock_out', name: '出库单', fields: [{ id: 'status', label: '状态', type: 'text' }] },
  { id: 'stock_out_items', name: '出库明细', fields: [
    { id: 'stock_out_id', label: '出库单', type: 'text' },
    { id: 'product_id', label: '商品', type: 'text' },
    { id: 'quantity', label: '数量', type: 'number' }
  ] }
];
pkg.ui = {
  home: { layout: 'dashboard', cards: [] },
  pages: pkg.schema.entities.map((entity) => ({ id: `${entity.id}-list`, title: entity.name, type: 'list', entity: entity.id }))
};
pkg.actions = { actions: [] };

const app = createAppFromPackage(pkg);
const successProduct = createRecord(app.id, 'products', { name: 'iPhone 15', stock: 10 });
const successStockOut = createRecord(app.id, 'stock_out', { status: 'draft' });
createRecord(app.id, 'stock_out_items', { stock_out_id: successStockOut.id, product_id: successProduct.id, quantity: 2 });

const blockedProduct = createRecord(app.id, 'products', { name: 'AirPods Pro', stock: 0 });
const blockedStockOut = createRecord(app.id, 'stock_out', { status: 'draft' });
createRecord(app.id, 'stock_out_items', { stock_out_id: blockedStockOut.id, product_id: blockedProduct.id, quantity: 1 });

const server = createAppServer().listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({
    url: `http://127.0.0.1:${port}/rules/ai-config`,
    appId: app.id,
    success: { sourceRecordId: successStockOut.id, productId: successProduct.id, expectedStock: '10 → 8' },
    blocked: { sourceRecordId: blockedStockOut.id, productId: blockedProduct.id, expectedStock: '0 → 0' }
  }, null, 2));
});

async function shutdown() {
  await new Promise((resolve) => server.close(resolve));
}

process.on('SIGINT', () => shutdown().finally(() => process.exit(0)));
process.on('SIGTERM', () => shutdown().finally(() => process.exit(0)));
