import { readFile } from 'node:fs/promises';
import { archiveMigratedFile } from '../settings/storage-migrations.js';

/** Complete schedule objects preserve retry/resume/pending state across restarts. */
export class SqliteScheduleStore {
  #queue = Promise.resolve();
  constructor(db) { this.db = db; }

  async prepare(legacyPath) {
    if (this.db.prepare('SELECT 1 FROM schema_migrations WHERE id=?').get('p4-schedules')) {archiveMigratedFile(legacyPath);return this;}
    let schedules = [];
    try {
      const parsed = JSON.parse(await readFile(legacyPath, 'utf8'));
      if (parsed.version !== 1 || !Array.isArray(parsed.schedules)) throw Error('Invalid schedule store');
      schedules = parsed.schedules;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    this.db.exec('SAVEPOINT import_schedules');
    try {
      for (const schedule of schedules) {
        if (!schedule?.id) throw Error('Invalid legacy schedule id');
        if (!this.#get(schedule.id)) this.#put(schedule);
      }
      this.db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run('p4-schedules',new Date().toISOString());
      this.db.exec('RELEASE import_schedules');
    } catch (error) { this.db.exec('ROLLBACK TO import_schedules; RELEASE import_schedules'); throw error; }
    archiveMigratedFile(legacyPath);
    return this;
  }
  list() { return this.#locked(() => this.db.prepare('SELECT definition FROM schedules ORDER BY rowid').all().map(row => JSON.parse(row.definition))); }
  get(id) { return this.#locked(() => this.#get(id)); }
  upsert(schedule) { return this.#locked(() => { this.#put(schedule); return structuredClone(schedule); }); }
  remove(id) { return this.#locked(() => this.db.prepare('DELETE FROM schedules WHERE id=?').run(id).changes > 0); }
  mutate(id, patch) {
    return this.#locked(() => {
      this.db.exec('SAVEPOINT mutate_schedule');
      try {
        const current = this.#get(id);
        const updated = current ? (typeof patch === 'function' ? patch(current) ?? current : {...current,...patch}) : null;
        if (updated) this.#put(updated);
        this.db.exec('RELEASE mutate_schedule');
        return structuredClone(updated);
      } catch(error) { this.db.exec('ROLLBACK TO mutate_schedule; RELEASE mutate_schedule'); throw error; }
    });
  }
  #get(id) { const row=this.db.prepare('SELECT definition FROM schedules WHERE id=?').get(id); return row ? JSON.parse(row.definition) : null; }
  #put(schedule) {
    this.db.prepare(`INSERT INTO schedules(id,product_id,name,enabled,next_run_at,definition,updated_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET product_id=excluded.product_id,name=excluded.name,enabled=excluded.enabled,
      next_run_at=excluded.next_run_at,definition=excluded.definition,updated_at=excluded.updated_at`)
      .run(schedule.id,schedule.product_id??null,schedule.name??null,schedule.enabled===false?0:1,
        schedule.next_run_at??null,JSON.stringify(schedule),schedule.updated_at||new Date().toISOString());
  }
  #locked(action) { const next=this.#queue.then(action,action); this.#queue=next.catch(()=>{}); return next; }
}
