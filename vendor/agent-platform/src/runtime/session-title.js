/** Extract user text without using attachment bodies or serializing transport envelopes. */
export function userQuestionText(content) {
  if(typeof content==='string') {
    try {
      const value=JSON.parse(content);
      if(Array.isArray(value)&&value.some(part=>part&&typeof part==='object'&&part.type==='text'))return userQuestionText(value);
    } catch { /* Plain text is the normal string representation. */ }
    return content.trim();
  }
  if(!Array.isArray(content))return '';
  return content.filter(part=>part?.type==='text').map(part=>part.text||'').join('\n').trim();
}
export function automaticSessionTitle(content, suggestion) {
  const text=userQuestionText(content).replace(/\s+/g,' ').trim();
  const greeting=/^(?:你好|您好|嗨|哈喽|在吗|hello|hi|hey)[!！?？。，,.\s]*$/i.test(text);
  const hasAttachment=Array.isArray(content)&&content.some(part=>['image_ref','image_url','document_ref'].includes(part?.type));
  const substantive=Boolean(text&&!greeting||hasAttachment);
  const proposed=substantive&&typeof suggestion==='string'?suggestion.replace(/\s+/g,' ').replace(/^["“「]|["”」]$/g,'').trim():'';
  const title=proposed||text||(hasAttachment?'附件问答':'');
  return {title:Array.from(title).slice(0,40).join(''),substantive};
}
