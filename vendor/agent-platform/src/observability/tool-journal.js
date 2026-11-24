import {mkdir,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createHash} from 'node:crypto';
import {recordSqliteToolEntry} from './sqlite-journal.js';
import {archiveMigratedFile} from '../settings/storage-migrations.js';

/** User-visible tool history; DB-backed in production, optional file adapter for integrations. */
export class ToolJournal {
  constructor(path,{database=null,...metadata}={}){this.path=path;this.db=database;this.metadata=metadata;this.entries=[];this.startIndex=0;}
  async load(){
    if(this.db) {
      const id='product-tool-file-'+createHash('sha256').update(this.path).digest('hex');
      if(!this.db.prepare('SELECT 1 FROM schema_migrations WHERE id=?').get(id)) {
        let legacy=[];try{legacy=JSON.parse(await readFile(this.path,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
        if(!Array.isArray(legacy))throw Error('Tool journal must be a JSON array');
        this.db.exec('SAVEPOINT migrate_product_tools');
        try {
          for(const [index,entry] of legacy.entries()) {
            const matched=entry.callId&&this.metadata.journalPath?this.db.prepare("SELECT e.run_id,json_extract(e.event,'$.payload.name') AS tool FROM run_events e JOIN runs r ON r.run_id=e.run_id WHERE r.owner=? AND r.journal_path=? AND json_extract(e.event,'$.payload.call_id')=? AND json_extract(e.event,'$.type')='tool_started' ORDER BY e.rowid DESC LIMIT 1")
              .get(this.metadata.owner||'local',this.metadata.journalPath,entry.callId):null;
            const runId=matched?.run_id||id;
            if(!matched)this.db.prepare("INSERT INTO runs(run_id,source,owner,status,started_at,finished_at) VALUES(?,'legacy-product-tools',?,'run_completed',?,?) ON CONFLICT(run_id) DO NOTHING")
              .run(runId,this.metadata.owner||'local',entry.time||new Date().toISOString(),entry.time||new Date().toISOString());
            recordSqliteToolEntry(this.db,{...entry,callId:entry.callId||`legacy-${index}`,platformTool:entry.platformTool||matched?.tool||entry.tool},{...this.metadata,runId});
          }
          this.db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(id,new Date().toISOString());
          this.db.exec('RELEASE migrate_product_tools');
        }catch(error){this.db.exec('ROLLBACK TO migrate_product_tools; RELEASE migrate_product_tools');throw error;}
      }
      archiveMigratedFile(this.path);
      this.entries=this.db.prepare('SELECT record FROM tool_invocations WHERE run_id=? AND record IS NOT NULL ORDER BY started_at').all(this.metadata.runId).map(row=>JSON.parse(row.record));
      this.startIndex=this.entries.length;return this;
    }
    try{this.entries=JSON.parse(await readFile(this.path,'utf8'));}
    catch(error){if(error.code!=='ENOENT')throw error;this.entries=[];}
    if(!Array.isArray(this.entries))throw new Error('Tool journal must be a JSON array');
    this.startIndex=this.entries.length;return this;
  }
  currentRun(){return this.entries.slice(this.startIndex);}
  async append(entry){
    if(this.db){this.entries.push(recordSqliteToolEntry(this.db,entry,this.metadata));return;}
    this.entries.push(entry);await mkdir(dirname(this.path),{recursive:true,mode:0o700});
    const temporary=this.path+'.'+randomUUID()+'.tmp';
    try{await writeFile(temporary,JSON.stringify(this.entries,null,2),{mode:0o600});await rename(temporary,this.path);}
    catch(error){await rm(temporary,{force:true}).catch(()=>{});throw error;}
  }
}
