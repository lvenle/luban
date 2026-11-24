import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const fingerprint = rows => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const MAX_CHUNK_CHARS = 16000;
const MAX_CHUNKS_PER_TURN = 2;

/** Persist a summary of omitted turns without treating a stale summary as current. */
export async function prepareConversationSummary({directory,sessionID,omittedRows,summarize,onError=()=>{},database=null}) {
  if (!omittedRows.length) return {summary:'',covered:0,complete:true};
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(sessionID)) throw new Error('会话 ID 无效');
  const folder=join(directory,'.context-summaries');
  const path=join(folder,sessionID+'.json');
  let saved;
  try {
    if(database) {
      const row=database.prepare('SELECT summary,summary_covered,summary_fingerprint FROM sessions WHERE id=? AND deleted=0').get(sessionID);
      if(!row)throw Error('摘要对应的会话不存在');
      saved={summary:row.summary,covered:row.summary_covered,fingerprint:row.summary_fingerprint};
    } else saved=JSON.parse(await readFile(path,'utf8'));
  }
  catch(error) { if(error.code!=='ENOENT') onError(error); }
  let covered=Number.isInteger(saved?.covered) && saved.covered<=omittedRows.length
    && saved.fingerprint===fingerprint(omittedRows.slice(0,saved.covered)) ? saved.covered : 0;
  let summary=covered ? saved.summary : '';
  if(typeof summary!=='string' || summary.length>8000) { covered=0; summary=''; }
  for(let count=0;covered<omittedRows.length && count<MAX_CHUNKS_PER_TURN;count++) {
    let end=covered,chars=0;
    while(end<omittedRows.length && (chars===0 || chars+omittedRows[end].content.length<=MAX_CHUNK_CHARS)) {
      chars+=omittedRows[end].content.length;end++;
    }
    try {
      const next=await summarize({previousSummary:summary,rows:omittedRows.slice(covered,end)});
      if(typeof next!=='string' || !next.trim() || next.length>8000) throw new Error('上下文摘要为空或过长');
      summary=next.trim();covered=end;
      if(database) {
        const result=database.prepare('UPDATE sessions SET summary=?,summary_covered=?,summary_fingerprint=?,summary_updated_at=? WHERE id=? AND deleted=0')
          .run(summary,covered,fingerprint(omittedRows.slice(0,covered)),new Date().toISOString(),sessionID);
        if(!result.changes)throw Error('摘要对应的会话不存在');
        continue;
      }
      await mkdir(folder,{recursive:true,mode:0o700});
      const temp=path+'.'+randomUUID()+'.tmp';
      try { await writeFile(temp,JSON.stringify({covered,fingerprint:fingerprint(omittedRows.slice(0,covered)),summary}),{mode:0o600});await rename(temp,path); }
      catch(error) { await rm(temp,{force:true}).catch(()=>{});onError(error); }
    } catch(error) { onError(error);break; }
  }
  return {summary,covered,complete:covered===omittedRows.length};
}
