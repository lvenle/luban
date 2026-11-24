/** Deterministic article projection. Never executes scripts or embedded media. */
import {htmlToText} from './html-to-text.js';
const attribute=(tag,name)=>new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,'i').exec(tag)?.slice(1).find(v=>v!==undefined)||'';
export function articleMarkdown(html,baseUrl){
 const images=[],seen=new Map();
 let body=html.replace(/<(script|style|iframe|mp-common-videosnap)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
 body=body.replace(/<img\b[^>]*>/gi,tag=>{
  const raw=attribute(tag,'data-src')||attribute(tag,'src');let url;
  try{url=new URL(raw,baseUrl);if(!raw||!['http:','https:'].includes(url.protocol)||url.username||url.password)return '';}catch{return '';}
  let index=seen.get(url.href);
  if(index===undefined){index=images.length;seen.set(url.href,index);images.push({url:url.href,alt:htmlToText(attribute(tag,'alt')).slice(0,100),index});}
  return `\n\n@@ARTICLE_IMAGE_${index}@@\n\n`;
 });
 body=body.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi,(_,n,text)=>`\n\n${'#'.repeat(Number(n))} ${htmlToText(text)}\n\n`)
  .replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi,(_,attrs,text)=>{
   const label=htmlToText(text);try{const u=new URL(attribute(attrs,'href'),baseUrl);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?`[${label.replace(/[\[\]]/g,'')}](${u.href.replace(/[()]/g,encodeURIComponent)})`:label;}catch{return label;}
  })
  .replace(/<li\b[^>]*>/gi,'\n- ').replace(/<blockquote\b[^>]*>/gi,'\n> ')
  .replace(/<tr\b[^>]*>/gi,'\n| ').replace(/<\/(?:td|th)\s*>/gi,' | ')
  .replace(/<\/(?:p|div|section|h[1-6]|ul|ol|blockquote|table)\s*>/gi,'\n\n');
 return {markdown:htmlToText(body),images};
}
export function imageFormat(bytes){
 if(bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){
  if(bytes.readUInt32BE(16)*bytes.readUInt32BE(20)>40_000_000)throw Error('图片像素超过限制');
  return {ext:'.png',mimeType:'image/png'};
 }
 if(bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes[bytes.length-2]===255&&bytes[bytes.length-1]===217)return {ext:'.jpg',mimeType:'image/jpeg'};
 if(bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'&&bytes.readUInt32LE(4)+8===bytes.length)return {ext:'.webp',mimeType:'image/webp'};
 throw Error('图片不是支持的 PNG、JPEG 或 WebP 文件');
}
