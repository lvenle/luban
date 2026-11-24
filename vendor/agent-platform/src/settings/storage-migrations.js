import { readFileSync, existsSync, readdirSync, renameSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeWechatEvents } from './instance-runtime-storage.js';
import { persistMediaReferences } from '../media/persist-references.js';
import { executorIsAlive } from '../observability/process-identity.js';

function transaction(db,action) {
  db.exec('SAVEPOINT storage_migration');
  try { const result=action();db.exec('RELEASE storage_migration');return result; }
  catch(error) {db.exec('ROLLBACK TO storage_migration; RELEASE storage_migration');throw error;}
}
function once(db,id,action) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(id TEXT PRIMARY KEY,applied_at TEXT NOT NULL)');
  if(db.prepare('SELECT 1 FROM schema_migrations WHERE id=?').get(id))return {skipped:true};
  return transaction(db,()=>{
    const result=action();
    db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(id,new Date().toISOString());
    return {skipped:false,...result};
  });
}

/** Source files remain recoverable; archiving can safely be retried after commit. */
export function archiveMigratedFile(path) {
  if(existsSync(path)) {
    const target=path+'.migrated'+(existsSync(path+'.migrated')?'.'+randomUUID():'');
    if(process.platform!=='win32')chmodSync(path,0o600);
    renameSync(path,target);
  }
}

/** All event types, including tool results and late events, use the same media boundary. */
export function slimBase64RunEvents({db,directory}) {
  return once(db,'p0-media-references-v2',()=>{
    let updated=0,bytesExtracted=0,totalMatched=0;
    for(const table of ['run_events','run_late_events']) {
      const rows=db.prepare(`SELECT run_id,sequence,event FROM ${table} WHERE event LIKE '%base64%' OR event LIKE '%"data"%' OR event LIKE '%"blob"%'`).all();
      const update=db.prepare(`UPDATE ${table} SET event=? WHERE run_id=? AND sequence=?`);
      totalMatched+=rows.length;
      for(const row of rows) {
        const event=JSON.parse(row.event);
        const next=JSON.stringify(persistMediaReferences(event,directory));
        if(next===row.event)continue;
        bytesExtracted+=Math.max(0,Buffer.byteLength(row.event)-Buffer.byteLength(next));
        update.run(next,row.run_id,row.sequence);updated++;
      }
    }
    return {updated,bytesExtracted,totalMatched};
  });
}

export function reconcileRunningRuns({db,includeHosted=true}) {
  return transaction(db,()=>{
    const rows=db.prepare("SELECT run_id,executor_pid,executor_identity FROM runs WHERE status IN ('running','stopping')"+(includeHosted?'':' AND executor_pid IS NOT NULL')).all();
    let reconciled=0;
    for(const row of rows) {
      if(row.executor_pid && executorIsAlive(row.executor_pid,row.executor_identity)) continue;
      const terminal=db.prepare("SELECT event FROM run_events WHERE run_id=? AND json_extract(event,'$.type') IN ('run_completed','run_failed','run_cancelled') ORDER BY sequence DESC LIMIT 1").get(row.run_id);
      const event=terminal?JSON.parse(terminal.event):null;
      db.prepare('UPDATE runs SET status=?,finished_at=?,error=? WHERE run_id=?').run(
        event?.type||'interrupted',event?.timestamp||new Date().toISOString(),
        event?.payload?.message||(!event?'服务中断，运行未完成':null),row.run_id);
      reconciled++;
    }
    db.prepare("UPDATE tool_invocations SET status='cancelled',finished_at=? WHERE status='running' AND run_id IN (SELECT run_id FROM runs WHERE status<>'running')").run(new Date().toISOString());
    return {runningBefore:rows.length,reconciled};
  });
}

export function slimRunOwnersToRunsTable({db}) {
  return once(db,'p4-runs-v2',()=>{
    const rows=db.prepare('SELECT run_id,owner FROM run_owners').all();
    const insert=db.prepare(`INSERT INTO runs(run_id,source,owner,agent_id,agent_version,session_id,schedule_id,model,status,error,started_at,finished_at,execution_mode)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(run_id) DO NOTHING`);
    let inserted=0;
    for(const row of rows) {
      const events=db.prepare('SELECT event FROM run_events WHERE run_id=? ORDER BY sequence').all(row.run_id).map(r=>JSON.parse(r.event));
      const start=events.find(e=>e.type==='run_started')||events[0],p=start?.payload||{};
      const end=[...events].reverse().find(e=>['run_completed','run_failed','run_cancelled'].includes(e.type));
      inserted+=insert.run(row.run_id,p.source||'debug',row.owner,p.agent_id??null,p.agent_snapshot?.version??null,
        start?.session_id??null,p.schedule_id??null,p.model??null,end?.type||'interrupted',
        end?.payload?.message??null,start?.timestamp||new Date().toISOString(),end?.timestamp??null,p.executionMode||'real').changes;
    }
    return {inserted};
  });
}

export function slimWechatEventsJsonlToDb({db,jsonlPath,initialEvents=[]}) {
  return once(db,'p4-wechat-events',()=>{
    const events=[...initialEvents];
    if(existsSync(jsonlPath)) {
      const lines=readFileSync(jsonlPath,'utf8').split('\n');
      for(let i=0;i<lines.length;i++) {
        if(!lines[i].trim())continue;
        try {const e=JSON.parse(lines[i]);if(e?.eventId)events.push(e);}
        catch(error) {if(i!==lines.length-1)throw new Error(`Invalid WeChat event on line ${i+1}`,{cause:error});}
      }
    }
    writeWechatEvents(db,persistMediaReferences(events,join(jsonlPath,'..')));
    return {imported:events.length};
  });
}

export function slimConversationsToTable({db,state}) {
  return once(db,'p3-conversations',()=>{
    const insert=db.prepare(`INSERT INTO conversations(channel,conversation_id,session_id,last_reply_at,pending,updated_at)
      VALUES('wechat',?,?,?,?,?) ON CONFLICT(channel,conversation_id) DO NOTHING`);
    let inserted=0;
    for(const [id,value] of Object.entries(state?.wechat?.conversations||{})) {
      if(!value||typeof value!=='object')continue;
      const sessionId=value.sessionId&&db.prepare('SELECT 1 FROM sessions WHERE id=? AND deleted=0').get(value.sessionId)?value.sessionId:null;
      inserted+=insert.run(id,sessionId,value.lastReplyAt||null,value.pending?JSON.stringify(value.pending):null,
        value.updatedAt||new Date().toISOString()).changes;
    }
    return {inserted};
  });
}

export function slimModelDiagnosticsToTable({db,state}) {
  return once(db,'p3-model-diagnostics',()=>{
    const insert=db.prepare(`INSERT INTO model_diagnostics(connection_id,model_id,health,health_checked_at,failure_count,card,updated_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(connection_id,model_id) DO NOTHING`);
    let inserted=0;
    for(const [id,value] of Object.entries(state?.modelStatus||{})) {
      inserted+=insert.run(id,'',JSON.stringify(value.health||null),value.health?.checkedAt||null,value.failureCount||0,null,
        new Date().toISOString()).changes;
    }
    for(const [id,models] of Object.entries(state?.modelCards||{}))for(const [model,card] of Object.entries(models||{})) {
      inserted+=insert.run(id,model,null,null,0,JSON.stringify(card),new Date().toISOString()).changes;
    }
    return {inserted};
  });
}

export function slimHistoryToConfigRevisions({db,state,now=()=>new Date().toISOString()}) {
  return once(db,'p2-config-revisions',()=>{
    const insert=db.prepare('INSERT INTO config_revisions VALUES(?,?,?) ON CONFLICT(revision) DO NOTHING');
    let inserted=0,d1Stripped=0;
    for(const entry of state?.history||[]) {
      if(!Number.isInteger(entry?.revision))continue;
      const cloned=structuredClone(entry);
      delete cloned.secrets;delete cloned.history;delete cloned.modelCards;delete cloned.modelStatus;
      if(cloned.wechat) {
        if(cloned.wechat.conversations||cloned.wechat.events)d1Stripped++;
        delete cloned.wechat.conversations;delete cloned.wechat.events;
      }
      inserted+=insert.run(cloned.revision,JSON.stringify(cloned),now()).changes;
    }
    return {inserted,d1Stripped};
  });
}

export function migrateConversationSummaries({db,directory}) {
  return once(db,'p3-session-summaries',()=>{
    const folder=join(directory,'.context-summaries');
    let imported=0;
    if(!existsSync(folder))return {imported};
    for(const name of readdirSync(folder)) {
      if(!/^[a-zA-Z0-9-]{1,80}\.json$/.test(name))continue;
      const saved=JSON.parse(readFileSync(join(folder,name),'utf8'));
      if(typeof saved.summary!=='string'||!Number.isInteger(saved.covered))throw Error('Invalid legacy conversation summary');
      imported+=db.prepare(`UPDATE sessions SET summary=?,summary_covered=?,summary_fingerprint=?,summary_updated_at=?
        WHERE id=? AND summary IS NULL`).run(saved.summary,saved.covered,saved.fingerprint??null,new Date().toISOString(),name.slice(0,-5)).changes;
    }
    return {imported};
  });
}

export const RETENTION_DEFAULTS=Object.freeze({runEventsDays:90,runLateEventsDays:90,wechatDays:90,toolDays:30,auditDays:90});

/** Bounded whole-run deletion prevents truncating active histories or terminal evidence. */
export function applyRunEventRetention({db,now=Date.now(),retention=RETENTION_DEFAULTS,batchSize=500}) {
  const policy={...RETENTION_DEFAULTS,...retention},cutoff=days=>new Date(now-days*86400000).toISOString();
  const stats={removedRunEvents:0,removedRunLateEvents:0,removedRuns:0,removedWechatEvents:0,removedTools:0,removedAudits:0};
  transaction(db,()=>{
    const runs=db.prepare(`SELECT run_id FROM runs r WHERE status<>'running' AND COALESCE(finished_at,started_at)<?
      AND NOT EXISTS(SELECT 1 FROM conversations c WHERE instr(COALESCE(c.pending,''),r.run_id)>0) LIMIT ?`)
      .all(cutoff(policy.runEventsDays),batchSize);
    for(const {run_id:id} of runs) {
      stats.removedRunEvents+=db.prepare('DELETE FROM run_events WHERE run_id=?').run(id).changes;
      stats.removedRunLateEvents+=db.prepare('DELETE FROM run_late_events WHERE run_id=?').run(id).changes;
      db.prepare('DELETE FROM tool_invocations WHERE run_id=?').run(id);
      db.prepare('DELETE FROM run_owners WHERE run_id=?').run(id);
      db.prepare('DELETE FROM runs WHERE run_id=?').run(id);stats.removedRuns++;
    }
    const messages=db.prepare(`SELECT e.event_id FROM wechat_events e JOIN wechat_dispatch d USING(event_id)
      WHERE e.occurred_at<? AND (d.allowed=0 OR d.dispatch_status IN ('replied','success','skipped','self_message'))
      AND NOT EXISTS(SELECT 1 FROM conversations c WHERE instr(COALESCE(c.pending,''),e.event_id)>0) LIMIT ?`)
      .all(now-policy.wechatDays*86400000,batchSize);
    for(const {event_id:id} of messages) {
      db.prepare('DELETE FROM wechat_dispatch WHERE event_id=?').run(id);
      stats.removedWechatEvents+=db.prepare('DELETE FROM wechat_events WHERE event_id=?').run(id).changes;
    }
    stats.removedTools=db.prepare(`DELETE FROM tool_invocations WHERE id IN (SELECT t.id FROM tool_invocations t
      LEFT JOIN runs r ON r.run_id=t.run_id WHERE t.finished_at<? AND COALESCE(r.status,'')<>'running' LIMIT ?)`)
      .run(cutoff(policy.toolDays),batchSize).changes;
    stats.removedAudits=db.prepare('DELETE FROM schedule_audit_events WHERE event_id IN (SELECT event_id FROM schedule_audit_events WHERE recorded_at<? LIMIT ?)')
      .run(cutoff(policy.auditDays),batchSize).changes;
    db.exec('DELETE FROM config_revisions WHERE revision NOT IN (SELECT revision FROM config_revisions ORDER BY revision DESC LIMIT 200)');
  });
  if(Object.values(stats).some(Boolean))db.exec('PRAGMA incremental_vacuum(128)');
  return stats;
}
