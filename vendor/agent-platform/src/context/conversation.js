const MAX_MESSAGE_CHARS = 6000;
const DEFAULT_BUDGET = 24000;

/** Keep whole user/assistant exchanges instead of an arbitrary number of rows. */
export function selectConversation(messages, budget = DEFAULT_BUDGET) {
  const rows = (Array.isArray(messages) ? messages : [])
    .filter(row => (row?.role === 'user' || row?.role === 'assistant') && typeof row.content === 'string')
    .map(row => ({id:typeof row.id==='string'?row.id:'',role:row.role, content:row.content.slice(0, MAX_MESSAGE_CHARS)}));
  const turns = [];
  for (const row of rows) {
    if (row.role === 'user' || !turns.length) turns.push([row]);
    else turns.at(-1).push(row);
  }
  const selected = [];
  let chars = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const turnChars = turns[i].reduce((sum, row) => sum + row.content.length, 0);
    if (selected.length && chars + turnChars > budget) break;
    selected.unshift(...turns[i]);
    chars += turnChars;
  }
  const omitted = rows.length-selected.length;
  return {rows:selected, omitted, omittedRows:rows.slice(0,omitted), chars};
}

/** Preserve source message IDs needed by cross-turn follow-up confirmation. */
export function toCanonicalMessages(rows) {
  return rows.map(row=>({role:row.role,content:row.role==='user'&&row.id?`[用户消息 ID: ${row.id}]\n${row.content}`:row.content}));
}
