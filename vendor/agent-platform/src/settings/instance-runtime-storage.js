/** Runtime state persisted in the shared instance database. */
// Timestamp compatibility for existing instance records.
function wechatEpochMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  const text = typeof value === 'string' ? value.trim() : '';
  if (/^\d+$/.test(text)) return wechatEpochMs(Number(text));
  const parsed = text ? Date.parse(text) : NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
}
const decode = value => { try { return JSON.parse(value); } catch { return null; } };

export function writeWechatEvents(db, events) {
  const eventStmt = db.prepare(`INSERT INTO wechat_events(event_id,account_id,conversation_id,sender_name,direction,is_self,message_type,text,attachments,raw,occurred_at,recorded_at,event_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET
    account_id=excluded.account_id,conversation_id=excluded.conversation_id,sender_name=excluded.sender_name,
    direction=excluded.direction,is_self=excluded.is_self,message_type=excluded.message_type,
    occurred_at=excluded.occurred_at,attachments=excluded.attachments, raw=excluded.raw, text=excluded.text, event_json=excluded.event_json`);
  const dispatchStmt = db.prepare(`INSERT INTO wechat_dispatch(event_id,allowed,reason,batch_id,dispatch_status,reply_content,replied_at,reply_reason,carried_forward,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET
    allowed=excluded.allowed,reason=excluded.reason,batch_id=excluded.batch_id,dispatch_status=excluded.dispatch_status,
    reply_content=excluded.reply_content,replied_at=excluded.replied_at,reply_reason=excluded.reply_reason,
    carried_forward=excluded.carried_forward,updated_at=excluded.updated_at`);
  db.exec('SAVEPOINT wechat_event_write');
  try {
    const existing = db.prepare('SELECT event_json FROM wechat_events WHERE event_id=?');
    for (const incoming of events) {
      if (!incoming?.eventId) continue;
      const previous=decode(existing.get(incoming.eventId)?.event_json)||{};
      const e={...previous,...incoming,automation:{...previous.automation,...incoming.automation}};
      const a = e.automation || {}, at = new Date().toISOString();
      eventStmt.run(e.eventId,e.accountId??null,e.conversationId??null,e.senderName??null,e.direction??null,e.isSelf?1:0,
        e.messageType??null,e.text??null,JSON.stringify(e.attachments||[]),JSON.stringify(e.raw||{}),
        wechatEpochMs(e.occurredAt??e.timestamp),e.recordedAt||at,JSON.stringify(e));
      dispatchStmt.run(e.eventId,a.allowed==null?null:Number(a.allowed),a.reason??null,e.batchId??a.batchId??null,
        a.dispatchStatus??null,a.replyContent??null,a.replyAt??a.repliedAt??null,a.replyReason??null,Number(a.carriedForward===true),at);
    }
    db.exec('RELEASE wechat_event_write');
  } catch (error) { db.exec('ROLLBACK TO wechat_event_write; RELEASE wechat_event_write'); throw error; }
}

export function readWechatEvents(db, limit) {
  return db.prepare(`SELECT e.*,d.allowed,d.reason,d.batch_id,d.dispatch_status,d.reply_content,d.replied_at,d.reply_reason,d.carried_forward
    FROM wechat_events e LEFT JOIN wechat_dispatch d ON d.event_id=e.event_id ORDER BY e.occurred_at DESC,e.rowid DESC LIMIT ?`).all(limit).reverse().map(decodeWechatRow);
}

function decodeWechatRow(row) {
    const e = decode(row.event_json) || {eventId:row.event_id,accountId:row.account_id,conversationId:row.conversation_id,
      senderName:row.sender_name,direction:row.direction,isSelf:Boolean(row.is_self),messageType:row.message_type,
      text:row.text,attachments:decode(row.attachments)||[],raw:decode(row.raw)||{},timestamp:row.occurred_at};
    e.automation = {...(e.automation||{}), ...(row.allowed==null?{}:{allowed:Boolean(row.allowed)}),
      ...(row.reason==null?{}:{reason:row.reason}), ...(row.dispatch_status==null?{}:{dispatchStatus:row.dispatch_status}),
      ...(row.reply_content==null?{}:{replyContent:row.reply_content}), ...(row.replied_at==null?{}:{replyAt:row.replied_at}),
      ...(row.reply_reason==null?{}:{replyReason:row.reply_reason}), ...(row.carried_forward?{carriedForward:true}:{})};
    if (row.batch_id) e.batchId = row.batch_id;
    return e;
}
/** Full retained conversation, independent of the global last-1000 listener cache. */
export function readWechatConversationEvents(db,conversationId,accountId=null) {
  return db.prepare(`SELECT e.*,d.allowed,d.reason,d.batch_id,d.dispatch_status,d.reply_content,d.replied_at,d.reply_reason,d.carried_forward
    FROM wechat_events e LEFT JOIN wechat_dispatch d ON d.event_id=e.event_id
    WHERE e.conversation_id=? AND (? IS NULL OR e.account_id=? OR e.account_id IS NULL)
    ORDER BY e.occurred_at,e.rowid`).all(conversationId,accountId,accountId).map(decodeWechatRow);
}
export function readWechatEventsById(db,ids) {
  if(!ids.length)return [];
  return db.prepare(`SELECT e.*,d.allowed,d.reason,d.batch_id,d.dispatch_status,d.reply_content,d.replied_at,d.reply_reason,d.carried_forward
    FROM wechat_events e LEFT JOIN wechat_dispatch d ON d.event_id=e.event_id WHERE e.event_id IN (${ids.map(()=>'?').join(',')})
    ORDER BY e.occurred_at,e.rowid`).all(...ids).map(decodeWechatRow);
}

/** Filtering and pagination use all persisted rows, independently of the listener cache. */
export function pageWechatEvents(db,{page=1,pageSize=50,inboundOnly=true,sender='',query='',from=null,to=null}={}) {
  const size=Math.min(500,Math.max(1,Math.floor(Number(pageSize))||50));
  const clauses=[],params=[];
  if (inboundOnly) clauses.push("COALESCE(e.direction,'') <> 'outbound' AND e.is_self=0");
  const senderKey=String(sender??'').trim().toLowerCase();
  if(senderKey) {clauses.push("instr(lower(COALESCE(e.sender_name,'') || ' ' || COALESCE(e.conversation_id,'')),?)>0");params.push(senderKey);}
  for(const [value,op] of [[from,'>='],[to,'<=']]) if(value!==null&&value!==''&&Number.isFinite(Number(value))) {
    clauses.push(`e.occurred_at ${op} ?`);params.push(Number(value));
  }
  const keyword=String(query??'').trim().toLowerCase();
  if(keyword) {
    clauses.push(`(instr(lower(COALESCE(e.text,'') || ' ' || COALESCE(json_extract(e.event_json,'$.imageSummary'),'') || ' ' ||
      COALESCE(json_extract(e.raw,'$.last_message'),'') || ' ' || COALESCE(json_extract(e.raw,'$.content'),'')),?)>0
      OR EXISTS(SELECT 1 FROM json_each(e.attachments) a WHERE instr(lower(COALESCE(json_extract(a.value,'$.analysis.text'),'') || ' ' ||
      COALESCE(json_extract(a.value,'$.analysis.transcript'),'')),?)>0))`);
    params.push(keyword,keyword);
  }
  const where=clauses.length?' WHERE '+clauses.join(' AND '):'';
  const total=db.prepare('SELECT COUNT(*) n FROM wechat_events e'+where).get(...params).n;
  const pageCount=Math.max(1,Math.ceil(total/size)),current=Math.min(pageCount,Math.max(1,Math.floor(Number(page))||1));
  const items=db.prepare(`SELECT e.*,d.allowed,d.reason,d.batch_id,d.dispatch_status,d.reply_content,d.replied_at,d.reply_reason,d.carried_forward
    FROM wechat_events e LEFT JOIN wechat_dispatch d ON d.event_id=e.event_id ${where}
    ORDER BY e.occurred_at DESC,e.rowid DESC LIMIT ? OFFSET ?`).all(...params,size,(current-1)*size).map(decodeWechatRow);
  return {items,total,page:current,pageSize:size,pageCount};
}

export function readConversations(db) {
  return Object.fromEntries(db.prepare('SELECT * FROM conversations WHERE channel=?').all('wechat').map(r => [r.conversation_id,
    {sessionId:r.session_id,lastReplyAt:r.last_reply_at,pending:decode(r.pending),updatedAt:r.updated_at}]));
}
export function writeConversation(db, chatId, entry) {
  if(entry.sessionId&&!db.prepare('SELECT 1 FROM sessions WHERE id=? AND deleted=0').get(entry.sessionId))throw Error('Conversation session does not exist');
  db.prepare(`INSERT INTO conversations(channel,conversation_id,session_id,last_reply_at,pending,updated_at) VALUES('wechat',?,?,?,?,?)
    ON CONFLICT(channel,conversation_id) DO UPDATE SET session_id=excluded.session_id,last_reply_at=excluded.last_reply_at,pending=excluded.pending,updated_at=excluded.updated_at`)
    .run(chatId,entry.sessionId,entry.lastReplyAt,entry.pending?JSON.stringify(entry.pending):null,entry.updatedAt);
}
export function readModelStatus(db, id) {
  const row = db.prepare("SELECT * FROM model_diagnostics WHERE connection_id=? AND model_id=''").get(id);
  if (!row) return {failureCount:0};
  return {failureCount:row.failure_count,health:decode(row.health)||{status:row.health||'unknown',checkedAt:row.health_checked_at}};
}
export function writeModelStatus(db,id,entry) {
  db.prepare(`INSERT INTO model_diagnostics(connection_id,model_id,health,health_checked_at,failure_count,updated_at) VALUES(?,'',?,?,?,?)
    ON CONFLICT(connection_id,model_id) DO UPDATE SET health=excluded.health,health_checked_at=excluded.health_checked_at,failure_count=excluded.failure_count,updated_at=excluded.updated_at`)
    .run(id,JSON.stringify(entry.health||null),entry.health?.checkedAt??null,entry.failureCount||0,new Date().toISOString());
}
