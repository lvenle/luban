// Save diagnostic output to a JSON file
// Run: node inspect-gantt.mjs   (requires Node >= 22 for node:sqlite)

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
const row = db.prepare('SELECT * FROM apps WHERE id = ?').get('app_b5242308372d4baf9b');
if (!row) { console.log('App not found'); process.exit(1); }

const schema = JSON.parse(row.schemaJson);
const ui = JSON.parse(row.uiJson);
const result = { appId: row.id, schema, ui };

// Find all gantt views
for (const page of ui.pages) {
  if (page.views) {
    for (const v of page.views) {
      if (v.id === 'view_mqror882_avvyw' || v.type === 'gantt') {
        console.log('\n=== View:', v.name, '(' + v.id + ') ===');
        console.log('  gantt:', JSON.stringify(v.gantt, null, 4));
        console.log('  visibleFields count:', v.visibleFields?.length);
        const entity = schema.entities.find(e => e.id === page.entity);
        if (entity) {
          console.log('  Entity fields:');
          for (const f of entity.fields) {
            console.log('    ' + f.id + ' -> ' + f.label + ' (' + f.type + ')');
            if (f.id === v.gantt?.startField) console.log('      ^^^ START FIELD');
            if (f.id === v.gantt?.endField) console.log('      ^^^ END FIELD');
          }

          // Check records
          const records = db.prepare('SELECT * FROM records WHERE appId = ? AND entityId = ?').all(result.appId, entity.id);
          console.log('\n  Records (' + records.length + '):');
          for (const rec of records) {
            const data = JSON.parse(rec.dataJson);
            const s = data[v.gantt?.startField];
            const e = data[v.gantt?.endField];
            const t = data[v.gantt?.titleField];
            const sParsed = s ? 'ok(' + new Date(s).toISOString() + ')' : 'MISSING';
            const eParsed = e ? 'ok(' + new Date(e).toISOString() + ')' : 'MISSING';
            console.log('    title=' + JSON.stringify(t) + ' start=' + JSON.stringify(s) + ' (' + sParsed + ') end=' + JSON.stringify(e) + ' (' + eParsed + ')');
          }
        }
      }
    }
  }
}

db.close();
