import {searchTerms} from '../knowledge/wiki.js';
const grams=text=>{const value=text.toLowerCase().replace(/\s+/g,'');return new Set(Array.from({length:Math.max(0,value.length-7)},(_,i)=>value.slice(i,i+8)))};
function similarity(a,b){const left=grams(a),right=grams(b);if(!left.size||!right.size)return a===b?1:0;let shared=0;for(const value of left)if(right.has(value))shared++;return shared/(left.size+right.size-shared)}
const titleKey=title=>String(title||'').split(/[\\/]/).at(-1).replace(/\s*[（(]\d+[）)](?=\.[^.]+$|$)/g,'').toLowerCase();
/** Select query-centered windows rather than truncating every document from its beginning. */
export function questionExcerpt(content,question,maxChars=1800){
 const body=String(content||'').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/,'');
 if(body.length<=maxChars)return body;
 const terms=searchTerms(question);
 const windows=[];for(let offset=0;offset<body.length;offset+=750){const text=body.slice(offset,offset+900),lower=text.toLowerCase();const score=terms.reduce((sum,term)=>sum+(lower.split(term).length-1)*Math.min(term.length,8),0);windows.push({offset,text,score})}
 const picked=[];for(const window of windows.sort((a,b)=>b.score-a.score||a.offset-b.offset)){if(picked.every(item=>Math.abs(item.offset-window.offset)>=900))picked.push(window);if(picked.length===2)break}
 return picked.sort((a,b)=>a.offset-b.offset).map(item=>item.text).join('\n…\n').slice(0,maxChars);
}
export function selectQuestionEvidence(citations,question,maxChars=6000,{requireRelevance=false}={}){
 if(requireRelevance){
  const terms=searchTerms(question).filter(term=>!['what','how','is','are','the','and','this','that'].includes(term));
  const scored=citations.map(item=>{const body=String(item.content||'').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/,'').toLowerCase();const score=terms.reduce((sum,term)=>sum+(body.includes(term)?Math.min(term.length,4):0),0);return {item,score}});
  const best=Math.max(0,...scored.map(entry=>entry.score));
  const fraction=/[a-z]{2,}/i.test(question)?0.75:0.6;
  citations=scored.filter(({item,score})=>(best>0&&score>=best*fraction)||(Number.isFinite(item.distance)&&item.distance<=0.35)).sort((a,b)=>b.score-a.score).map(entry=>entry.item);
 }

 const selected=[];let remaining=maxChars;
 for(const item of citations){if(remaining<=0)break;const content=questionExcerpt(item.content,question,Math.min(1800,remaining));if(!content.trim())continue;
  if(selected.some(previous=>similarity(previous.content,content)>=0.7||(titleKey(previous.title)===titleKey(item.title)&&similarity(previous.original,item.content)>=0.45)))continue;
  selected.push({...item,content,original:item.content});remaining-=content.length;
 }
 return selected.map(({original,...item})=>item);
}
