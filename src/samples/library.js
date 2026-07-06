import { readFileSync } from 'node:fs';
import { importAppPayload } from '../services/package-transfer.js';
import { notFound } from '../core/errors.js';

const catalogUrl = new URL('./catalog.json', import.meta.url);
let catalogCache = null;

export function sampleCatalog() {
  if (!catalogCache) catalogCache = JSON.parse(readFileSync(catalogUrl, 'utf8'));
  return catalogCache;
}

export function listSamples() {
  return (sampleCatalog().samples || []).map(({ payload, ...sample }) => ({
    ...sample,
    entityCount: payload.schema?.entities?.length || 0,
    recordCount: payload.sampleData?.length || 0,
    ruleCount: payload.businessRules?.length || 0
  }));
}

export function importSamples(ids) {
  const samples = sampleCatalog().samples || [];
  const byId = new Map(samples.map((sample) => [sample.id, sample]));
  return [...new Set(ids || [])].map((id) => {
    const sample = byId.get(id);
    if (!sample) throw notFound(`找不到样例：${id}`);
    const app = importAppPayload(structuredClone(sample.payload));
    return { sampleId: sample.id, appId: app.id, name: app.name };
  });
}
