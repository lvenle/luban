import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { listApps } from '../models/app.js';
import { exportAppPayload } from '../services/package-transfer.js';

const outputUrl = new URL('../samples/catalog.json', import.meta.url);
const apps = listApps();
const catalog = {
  version: 1,
  generatedAt: new Date().toISOString(),
  samples: apps.map((app) => ({
    id: app.slug,
    name: app.name,
    description: app.description || '',
    category: app.manifest?.category || '未分类',
    icon: app.icon || app.manifest?.icon || '',
    payload: exportAppPayload(app.id, 'all')
  }))
};

mkdirSync(dirname(outputUrl.pathname), { recursive: true });
writeFileSync(outputUrl, JSON.stringify(catalog, null, 2));
console.log(`已写入 ${catalog.samples.length} 个样例：${outputUrl.pathname}`);
