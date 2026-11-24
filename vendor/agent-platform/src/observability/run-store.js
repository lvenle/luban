import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { redact } from './redaction.js';
import {recordSqliteRunEvent} from './sqlite-journal.js';
import {archiveMigratedFile} from '../settings/storage-migrations.js';
import {createHash} from 'node:crypto';

export class RunStore {
  #queue = Promise.resolve();

  constructor(path, { maxRecordBytes = 256_000, database=null, ...metadata } = {}) {
    if (typeof path !== 'string' || !path) throw new TypeError('run store path is required');
    this.path = path;
    this.maxRecordBytes = maxRecordBytes;
    this.db=database;this.metadata={...metadata,journalPath:path};
  }
  async prepare() {
    if(!this.db)return this;
    const id='product-run-file-'+createHash('sha256').update(this.path).digest('hex');
    if(!this.db.prepare('SELECT 1 FROM schema_migrations WHERE id=?').get(id)) {
      let text='';try{text=await readFile(this.path,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
      this.db.exec('SAVEPOINT migrate_product_runs');
      try {
        for(const line of text.split('\n'))if(line.trim())recordSqliteRunEvent(this.db,JSON.parse(line),{...this.metadata,executorPid:null,source:'legacy-product-chat',
          agentId:null,model:null,sessionId:null,input:undefined,agentSnapshot:undefined});
        this.db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(id,new Date().toISOString());
        this.db.exec('RELEASE migrate_product_runs');
      } catch(error){this.db.exec('ROLLBACK TO migrate_product_runs; RELEASE migrate_product_runs');throw error;}
    }
    archiveMigratedFile(this.path);return this;
  }

  record(event) {
    if(this.db) {
      const action=()=>recordSqliteRunEvent(this.db,event,this.metadata);
      const next=this.#queue.then(action,action);this.#queue=next.catch(()=>{});return next;
    }
    const safe = redact({ ...event });
    const line = `${JSON.stringify(safe)}\n`;
    if (Buffer.byteLength(line) > this.maxRecordBytes) throw new RangeError('Run event exceeds storage limit');
    const write = async () => {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      await appendFile(this.path, line, { mode: 0o600 });
    };
    const next = this.#queue.then(write, write);
    this.#queue = next.catch(() => {});
    return next;
  }

  async query({ runId, requestId, type, limit = 1000 } = {}) {
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError('limit must be positive');
    await this.#queue;
    if(this.db) {
      const clauses=['r.owner=?'],params=[this.metadata.owner||'local'];
      if(runId){clauses.push('e.run_id=?');params.push(runId);}
      if(requestId){clauses.push("json_extract(e.event,'$.request_id')=?");params.push(requestId);}
      if(type){clauses.push("json_extract(e.event,'$.type')=?");params.push(type);}
      return this.db.prepare(`SELECT e.event FROM run_events e JOIN runs r ON r.run_id=e.run_id WHERE ${clauses.join(' AND ')} ORDER BY r.started_at,e.sequence LIMIT ?`)
        .all(...params,limit).map(row=>JSON.parse(row.event));
    }
    let text;
    try { text = await readFile(this.path, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const result = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      const event = JSON.parse(line);
      if (runId && event.run_id !== runId) continue;
      if (requestId && event.request_id !== requestId) continue;
      if (type && event.type !== type) continue;
      result.push(event);
      if (result.length >= limit) break;
    }
    return result;
  }
}
