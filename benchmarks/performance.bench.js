// Performance benchmark suite for luban-ai
// Run: node benchmarks/performance.bench.js
// Uses independent data/bench.sqlite — does not pollute production data.

import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { resetDbForTests, getDb } from '../src/storage/db.js';
import { createAppFromPackage } from '../src/models/app.js';
import { createBudgetPackage } from '../src/ai/samplePackages.js';
import { toCsv } from '../src/utils/export.js';
import { recordsToXlsx } from '../src/utils/xlsx.js';

const DB_PATH = join(process.cwd(), 'data', 'bench.sqlite');
const RUNS = { small: 1000, medium: 5000, large: 10000 };
const isoNow = new Date().toISOString();

// ── Helpers ──────────────────────────────────────────────────────────

function header(name) {
  console.log(`\n\x1b[1m${name}\x1b[0m`);
  console.log('-'.repeat(60));
}

function printRow(caseName, dataSize, start) {
  const dur = (performance.now() - start).toFixed(0);
  const durNum = Number(dur);
  const rps = (dataSize > 0 && durNum > 0) ? (dataSize / (durNum / 1000)).toFixed(0) : '-';
  console.log(
    `${caseName.padEnd(36)} ${String(dataSize).padStart(6)}  ${dur.padStart(6)} ms  ${rps.padStart(10)} rows/s`
  );
}

// Repeat a benchmark function until total duration >= 200ms (min 3, max 100 runs).
// Prints the average duration across all runs.
function benchRepeated(caseName, dataSize, fn, maxRuns = 100) {
  const runs = [];
  const minRuns = 3;
  const targetTotal = 200; // ms
  for (let i = 0; i < maxRuns; i++) {
    const start = performance.now();
    fn();
    runs.push(performance.now() - start);
    if (i + 1 >= minRuns && runs.reduce((a, b) => a + b, 0) >= targetTotal) break;
  }
  const avg = runs.reduce((a, b) => a + b, 0) / runs.length;
  const min = Math.min(...runs);
  const max = Math.max(...runs);
  const dur = avg.toFixed(0);
  const rps = (dataSize > 0 && avg > 0) ? (dataSize / (avg / 1000)).toFixed(0) : '-';
  console.log(
    `${caseName.padEnd(36)} ${String(dataSize).padStart(6)}  ${dur.padStart(6)} ms  ${rps.padStart(10)} rows/s  (${runs.length} runs, min ${min.toFixed(0)} max ${max.toFixed(0)})`
  );
}

function setup() {
  rmSync(DB_PATH, { force: true });
  resetDbForTests(DB_PATH);
  const app = createAppFromPackage(createBudgetPackage());
  return app;
}

// ── Test cases ───────────────────────────────────────────────────────

function benchCreateRecords(app, count) {
  const entity = app.schema.entities[0];
  const db = getDb();
  const start = performance.now();
  for (let i = 0; i < count; i++) {
    const data = {};
    for (const field of entity.fields) {
      if (field.type === 'text') data[field.id] = `记录 ${i} 号`;
      else if (field.type === 'number') data[field.id] = i * 1.5;
      else if (field.type === 'date') data[field.id] = '2026-06-12';
      else if (field.type === 'textarea') data[field.id] = '备注内容 '.repeat(5);
      else if (field.type === 'select') data[field.id] = field.options?.[0]?.id || '';
      else data[field.id] = '';
    }
    db.prepare(
      'INSERT INTO records (id, appId, entityId, dataJson, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(`bench_rec_${count}_${i}`, app.id, entity.id, JSON.stringify(data), isoNow, isoNow);
  }
  printRow(`创建 ${count} 条记录`, count, start);
}

function benchListRecords(app, count) {
  const db = getDb();
  const entity = app.schema.entities[0];
  const pageSize = 50;
  const pages = Math.min(20, Math.ceil(count / pageSize));
  const sql = db.prepare('SELECT id, dataJson FROM records WHERE appId = ? AND entityId = ? LIMIT ? OFFSET ?');
  benchRepeated(`列表分页读取 (${pages} 页)`, count, () => {
    for (let p = 0; p < pages; p++) sql.all(app.id, entity.id, pageSize, p * pageSize);
  });
}

function benchSearch(app, count) {
  const db = getDb();
  const entity = app.schema.entities[0];
  const sql = db.prepare("SELECT id, dataJson FROM records WHERE appId = ? AND entityId = ? AND dataJson LIKE ?");
  benchRepeated(`搜索 (LIKE 匹配)`, count, () => {
    sql.all(app.id, entity.id, `%500%`);
  });
}

function benchRelationOptions(app) {
  const db = getDb();
  const sql = db.prepare('SELECT id, dataJson FROM records WHERE appId = ? LIMIT 500');
  const records = sql.all(app.id);
  const readSql = db.prepare('SELECT id, dataJson FROM records WHERE appId = ? LIMIT 500');
  benchRepeated('关系字段选项加载', records.length, () => {
    readSql.all(app.id);
  });
}

function benchFormulaCompute(app, count) {
  const db = getDb();
  const rows = db.prepare('SELECT dataJson FROM records WHERE appId = ? LIMIT ?').all(app.id, count);
  benchRepeated(`公式字段批量计算`, count, () => {
    for (const row of rows) {
      const data = JSON.parse(row.dataJson);
      const amount = Number(data.amount || 0);
      const _result = amount * 0.8;
    }
  });
}

function benchCsvExport(app, count) {
  const db = getDb();
  const entity = app.schema.entities[0];
  const records = db.prepare(
    'SELECT id, dataJson FROM records WHERE appId = ? AND entityId = ? LIMIT ?'
  ).all(app.id, entity.id, count);
  const dataRecords = records.map((row) => ({ id: row.id, data: JSON.parse(row.dataJson) }));
  const start = performance.now();
  const _csv = toCsv(dataRecords, entity);
  printRow(`CSV 导出`, count, start);
}

function benchXlsxExport(app, count) {
  const db = getDb();
  const entity = app.schema.entities[0];
  const records = db.prepare(
    'SELECT id, dataJson FROM records WHERE appId = ? AND entityId = ? LIMIT ?'
  ).all(app.id, entity.id, count);
  const dataRecords = records.map((row) => ({ id: row.id, data: JSON.parse(row.dataJson) }));
  const start = performance.now();
  const _xlsx = recordsToXlsx(dataRecords, entity);
  printRow(`XLSX 导出`, count, start);
}

function benchAiSessionHistory(app) {
  const db = getDb();
  const sessionId = 'bench_session_long';
  db.prepare(
    'INSERT INTO ai_sessions (id, appId, type, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(sessionId, app.id, 'modify', 'completed', isoNow, isoNow);

  const insertMsg = db.prepare(
    'INSERT INTO ai_messages (id, sessionId, role, content, structuredContentJson, createdAt) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (let i = 0; i < 1000; i++) {
    insertMsg.run(
      `bench_msg_${i}`, sessionId,
      i % 2 === 0 ? 'user' : 'assistant',
      `这是第 ${i} 条消息，包含一些模拟内容以模拟长历史会话的读取开销。`.repeat(3),
      '[]', isoNow
    );
  }

  const sql = db.prepare('SELECT id, role, content, structuredContentJson, createdAt FROM ai_messages WHERE sessionId = ? ORDER BY createdAt');
  benchRepeated('AI 会话长历史读取 (1000 条消息)', 1000, () => {
    sql.all(sessionId);
  });
}

// ── Runner ───────────────────────────────────────────────────────────

async function main() {
  console.log('\n\x1b[1m══════════════════════════════════════════════════════\x1b[0m');
  console.log('\x1b[1m  鲁班 AI 系统 — 性能基准测试\x1b[0m');
  console.log('\x1b[1m══════════════════════════════════════════════════════\x1b[0m');
  console.log(`数据库: ${DB_PATH}`);
  console.log(`测试时间: ${new Date().toISOString()}\n`);

  // Clean up any previous bench DB
  rmSync(DB_PATH, { force: true });

  // ── Data creation benchmarks ──
  header('数据写入性能');

  for (const [label, count] of Object.entries(RUNS)) {
    const app = setup();
    benchCreateRecords(app, count);
  }

  // ── Read & list benchmarks (using 10k record set) ──
  header('数据读取性能');
  const largeApp = setup();
  benchCreateRecords(largeApp, 10000);
  benchListRecords(largeApp, 10000);
  benchSearch(largeApp, 10000);
  benchRelationOptions(largeApp);

  // ── Formula benchmarks ──
  header('计算性能');
  benchFormulaCompute(largeApp, 10000);

  // ── Export benchmarks ──
  header('导出性能');
  benchCsvExport(largeApp, 10000);
  benchXlsxExport(largeApp, 5000);

  // ── AI session benchmarks ──
  header('AI 会话性能');
  benchAiSessionHistory(largeApp);

  // Cleanup
  rmSync(DB_PATH, { force: true });

  console.log('\n\x1b[32m✓ 基准测试完成\x1b[0m');
  console.log('注意: 此数据库为独立测试文件，已自动清理。\n');
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
