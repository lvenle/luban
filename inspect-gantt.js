// Run with: node inspect-gantt.js
import { readFileSync } from 'node:fs';
const dbPath = new URL('./data/db.sqlite', import.meta.url);
const buf = readFileSync(dbPath);

// Find the app row for the gantt view
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(dbPath.pathname);
const row = db.prepare('SELECT * FROM apps WHERE id = ?').get('app_b5242308372d4baf9b');
if (!row) { console.log('App not found'); process.exit(1); }

const schema = JSON.parse(row.schemaJson);
const ui = JSON.parse(row.uiJson);

// Find the gantt view
for (const page of ui.pages) {
  if (page.views) {
    for (const v of page.views) {
      if (v.id === 'view_mqror882_avvyw' || (v.type === 'gantt')) {
        console.log('Found view:', v.name, v.id);
        console.log('  type:', v.type);
        console.log('  gantt config:', JSON.stringify(v.gantt, null, 2));
        const entity = schema.entities.find(e => e.id === page.entity);
        if (entity) {
          console.log('  Entity:', entity.name, entity.id);
          console.log('  Start field lookup:', entity.fields.find(f => f.id === v.gantt?.startField)?.label || 'NOT FOUND');
          console.log('  End field lookup:', entity.fields.find(f => f.id === v.gantt?.endField)?.label || 'NOT FOUND');
        }
      }
    }
  }
}

// Check records
const records = db.prepare('SELECT * FROM records WHERE appId = ? AND entityId = ?').all(row.id, 'task');
console.log('\nRecords:', records.length);
const ganttView = ui.pages.flatMap(p => p.views || []).find(v => v.type === 'gantt');
if (ganttView) {
  for (const rec of records) {
    const data = JSON.parse(rec.dataJson);
    const startVal = data[ganttView.gantt.startField];
    const endVal = data[ganttView.gantt.endField];
    console.log(`  ${rec.id.slice(0,12)}... start="${startVal}" end="${endVal}" -> title="${data[ganttView.gantt.titleField]}"`);
  }
}

db.close();
