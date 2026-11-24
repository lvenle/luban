import {createHash} from 'node:crypto';
import {redact} from './redaction.js';
import {persistMediaReferences} from '../media/persist-references.js';
import {processIdentity} from './process-identity.js';

function sanitize(value,secrets=[]) {
  let json=JSON.stringify(redact(value));
  for(const secret of secrets)if(secret)json=json.split(secret).join('[REDACTED]');
  return JSON.parse(json);
}
export function recordSqliteRunEvent(db,event,{directory,owner='local',source='product-chat',agentId=null,model=null,sessionId=null,executorPid=null,input,agentSnapshot,secretValues=[],journalPath=null}={}) {
  const safe=persistMediaReferences(sanitize({...event},secretValues),directory);
  const runId=safe.run_id||safe.request_id;
  if(!runId||!Number.isSafeInteger(safe.sequence))throw Error('Invalid run event identity');
  safe.run_id=runId;
  safe.session_id=safe.session_id||sessionId;
  if(safe.type==='run_started')safe.payload={...safe.payload,source,model:model||safe.payload?.model||null,agent_id:agentId||safe.payload?.agent_id,
    ...(input===undefined?{}:{input:persistMediaReferences(sanitize(input,secretValues),directory)}),...(agentSnapshot?{agent_snapshot:redact(agentSnapshot)}:{})};
  db.exec('SAVEPOINT record_product_event');
  try {
    const exists=db.prepare('SELECT 1 FROM runs WHERE run_id=?').get(runId);
    if(!exists)db.prepare(`INSERT INTO runs(run_id,source,owner,agent_id,session_id,model,status,started_at,executor_pid,executor_identity,journal_path)
      VALUES(?,?,?,?,?,?,'running',?,?,?,?)`)
      .run(runId,source,owner,agentId||safe.payload?.agent_id||null,sessionId,model||safe.payload?.model||null,safe.timestamp||new Date().toISOString(),executorPid,executorPid?processIdentity(executorPid):null,journalPath);
    const run=db.prepare('SELECT owner,status FROM runs WHERE run_id=?').get(runId);
    if(run.owner!==owner)throw Error('Run is not authorized');
    const duplicate=db.prepare('SELECT 1 FROM run_events WHERE run_id=? AND sequence=?').get(runId,safe.sequence);
    if(!duplicate) {
      const table=run.status==='running'?'run_events':'run_late_events';
      db.prepare(`INSERT INTO ${table} VALUES(?,?,?) ON CONFLICT(run_id,sequence) DO NOTHING`).run(runId,safe.sequence,JSON.stringify(safe));
      if(run.status==='running'&&['run_completed','run_failed','run_cancelled'].includes(safe.type)) {
        db.prepare('UPDATE runs SET status=?,finished_at=?,error=? WHERE run_id=?').run(safe.type,safe.timestamp||new Date().toISOString(),safe.payload?.message||null,runId);
      }
      if(run.status==='running'&&['tool_started','tool_completed'].includes(safe.type)) {
        const entry={callId:safe.payload.call_id,platformTool:safe.payload.name,time:safe.timestamp};
        const id=toolEntryId(runId,entry);
        const at=safe.timestamp||new Date().toISOString();
        db.prepare(`INSERT INTO tool_invocations(id,run_id,tool,source,status,started_at,finished_at,duration_ms,input_digest)
          VALUES(?,?,?,'business','running',?,?,0,?) ON CONFLICT(id) DO NOTHING`).run(id,runId,entry.platformTool,at,at,
            createHash('sha256').update(JSON.stringify(safe.payload.input??null)).digest('hex'));
        if(safe.type==='tool_completed')db.prepare(`UPDATE tool_invocations SET status=?,finished_at=?,error_message=?,output_digest=?,
          duration_ms=MAX(0,CAST((julianday(?)-julianday(started_at))*86400000 AS INTEGER)) WHERE id=?`).run(
            safe.payload.error||safe.payload.output?.isError?'failed':'ok',at,safe.payload.error??null,
            createHash('sha256').update(JSON.stringify(safe.payload.output??null)).digest('hex'),at,id);
      }
    }
    db.exec('RELEASE record_product_event');
  } catch(error){db.exec('ROLLBACK TO record_product_event; RELEASE record_product_event');throw error;}
  return safe;
}
function toolEntryId(runId,entry) {
  return createHash('sha256').update(JSON.stringify({runId,callId:entry.callId||null,tool:entry.platformTool||entry.tool,...(entry.callId?{}:{time:entry.time})})).digest('hex');
}

export function recordSqliteToolEntry(db,entry,{runId,directory,owner='local',secretValues=[]}={}) {
  const run=db.prepare('SELECT owner FROM runs WHERE run_id=?').get(runId);
  if(!run || run.owner!==owner)throw Error('Run is not authorized');
  const safe=persistMediaReferences(sanitize(entry,secretValues),directory);
  const digest=value=>createHash('sha256').update(JSON.stringify(value??null)).digest('hex');
  const id=toolEntryId(runId,safe);
  db.prepare(`INSERT INTO tool_invocations(id,run_id,tool,source,status,started_at,finished_at,duration_ms,error_message,input_digest,output_digest,record)
    VALUES(?,?,?,'business',?,?,?,0,?,?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record,status=excluded.status,
    finished_at=excluded.finished_at,error_message=excluded.error_message,output_digest=excluded.output_digest`)
    .run(id,runId,safe.platformTool||safe.tool,safe.status==='failed'?'failed':'ok',safe.time||new Date().toISOString(),safe.time||new Date().toISOString(),
      safe.message||null,digest(safe.input),digest(safe.result),JSON.stringify(safe));
  return safe;
}
