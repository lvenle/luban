// Fix the gantt view field mapping: swap startField and endField
// Run: node fix-gantt-config.mjs

import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, 'data', 'db.sqlite');

if (!existsSync(dbPath)) {
  console.log('Database not found at:', dbPath);
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
const row = db.prepare("SELECT * FROM apps WHERE id = ?").get("app_b5242308372d4baf9b");
if (!row) { console.log('App not found'); process.exit(1); }

const ui = JSON.parse(row.uiJson);

// Find and fix the gantt view
let fixed = false;
for (const page of ui.pages) {
  if (page.views) {
    for (const v of page.views) {
      if (v.id === 'view_mqror882_avvyw' && v.type === 'gantt') {
        console.log('Before fix:');
        console.log('  startField:', v.gantt.startField, '(截止日期)');
        console.log('  endField:', v.gantt.endField, '(开始日期)');

        // Swap them
        const temp = v.gantt.startField;
        v.gantt.startField = v.gantt.endField;
        v.gantt.endField = temp;

        console.log('\nAfter fix:');
        console.log('  startField:', v.gantt.startField, '(开始日期)');
        console.log('  endField:', v.gantt.endField, '(截止日期)');
        fixed = true;
      }
    }
  }
}

if (!fixed) {
  console.log('Gantt view not found');
  process.exit(1);
}

// Write back
db.prepare("UPDATE apps SET uiJson = ?, updatedAt = ? WHERE id = ?").run(
  JSON.stringify(ui),
  new Date().toISOString(),
  row.id
);

console.log('\nFix applied successfully! Refresh the page.');
db.close();
