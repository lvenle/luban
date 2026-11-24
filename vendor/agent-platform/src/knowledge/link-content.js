/** Public HTTP(S) only, DNS pinned per redirect, no cookies/auth; bounded decoded response. */
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { createGunzip,createInflate,createBrotliDecompress } from 'node:zlib';
import { htmlToText } from './html-to-text.js';
export function isPublicIPv4(ip){
  if(isIP(ip)!==4)return false;
  const [a,b]=ip.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51)||a===203&&b===0);
}
export async function fetchPublicHtml(address,{resolve=lookup,timeoutMs=15000,maxBytes=8*1024*1024,binary=false}={}){
  const deadline=Date.now()+timeoutMs;
  for(let hop=0;hop<=3;hop++){
    const url=new URL(address);
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port && !['80','443'].includes(url.port))throw Error('链接仅支持标准端口的公开 HTTP(S) 网页');
    const host=url.hostname.replace(/^\[|\]$/g,'');
    const timeLeft=deadline-Date.now();if(timeLeft<=0)throw Error('链接读取超时');
    let dnsTimer;const addresses=await Promise.race([resolve(host,{all:true,family:4}),new Promise((_,reject)=>{dnsTimer=setTimeout(()=>reject(Error('链接域名解析超时')),timeLeft);dnsTimer.unref?.();})]).finally(()=>clearTimeout(dnsTimer));
    if(!addresses.length||addresses.some(a=>!isPublicIPv4(a.address)))throw Error('拒绝访问本机、内网或保留地址');
    const result=await new Promise((resolveResult,reject)=>{
      let stream;
      const request=(url.protocol==='https:'?httpsRequest:httpRequest)(url,{family:4,autoSelectFamily:false,
        lookup:(_host,_opts,cb)=>cb(null,addresses[0].address,4),headers:{'user-agent':'Mozilla/5.0 AgentPlatformKnowledge/1.0','accept':binary?'image/png,image/jpeg,image/webp':'text/html,application/xhtml+xml','accept-encoding':'gzip, deflate, br'}},res=>{
        if([301,302,303,307,308].includes(res.statusCode)){const location=res.headers.location;res.destroy();if(!location)return reject(Error('链接跳转缺少地址'));return resolveResult({redirect:new URL(location,url).href});}
        if(res.statusCode!==200){res.destroy();return reject(Error(`链接读取失败：HTTP ${res.statusCode}`));}
        if(!binary&&!/text\/html|application\/xhtml\+xml/i.test(res.headers['content-type']||'')){res.destroy();return reject(Error('链接返回的不是 HTML 正文'));}
        const coding=res.headers['content-encoding'];
        const decoder=coding==='gzip'?createGunzip():coding==='deflate'?createInflate():coding==='br'?createBrotliDecompress():null;
        if(coding&&!decoder&&coding!=='identity'){res.destroy();return reject(Error('不支持的网页压缩格式'));}
        stream=decoder?res.pipe(decoder):res;
        const chunks=[];let size=0;
        stream.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){reject(Error('网页响应超过大小限制'));request.destroy();res.destroy();stream.destroy();}else chunks.push(chunk);});
        stream.on('end',()=>resolveResult(binary?{bytes:Buffer.concat(chunks),url:url.href}:{html:Buffer.concat(chunks).toString('utf8'),url:url.href}));
        stream.on('error',reject);res.on('error',reject);
      });
      const timer=setTimeout(()=>{request.destroy(Error('链接读取超时'));stream?.destroy();},Math.max(1,deadline-Date.now()));timer.unref?.();
      request.on('error',reject);request.on('close',()=>clearTimeout(timer));request.end();
    });
    if(result.redirect){address=result.redirect;continue;}
    return result;
  }
  throw Error('链接跳转次数过多');
}
export function elementHtml(html,pattern){
  const match=pattern.exec(html);if(!match)return '';
  const name=match[1],tags=new RegExp(`<\\/?${name}\\b[^>]*>`,'gi');tags.lastIndex=match.index+match[0].length;
  let depth=1,tag;while((tag=tags.exec(html))){depth+=tag[0].startsWith('</')?-1:1;if(!depth)return html.slice(match.index,tags.lastIndex);}
  return '';
}
export function extractArticle(html,url){
  const clean=html.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
  const wechat=new URL(url).hostname==='mp.weixin.qq.com';
  const selected=elementHtml(clean,/<(div)\b[^>]*\bid=["']js_content["'][^>]*>/i);
  if(wechat&&!selected)throw Error('公众号未返回文章正文，可能需要验证或文章不可用');
  const body=selected||elementHtml(clean,/<(article|main)\b[^>]*>/i)||clean.replace(/<(nav|footer|header|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
  const text=htmlToText(body);
  if(text.length<80 && !(wechat && /<img\b[^>]*(?:data-src|src)=["']https?:/i.test(body)))throw Error('未获得足够的文章正文，可能是验证或空白页面');
  const articleTitle=wechat?htmlToText(elementHtml(clean,/<(h[1-6])\b[^>]*\bid=["']activity-name["'][^>]*>/i)).replace(/^#+\s*/, ''):'';
  const account=wechat?htmlToText(elementHtml(clean,/<(a|span|strong)\b[^>]*\bid=["']js_name["'][^>]*>/i)):'';
  const ct=wechat?/\bvar\s+ct\s*=\s*["']?(\d{9,12})/.exec(html)?.[1]:null;
  return {text,bodyHtml:body,articleInfo:{account,publishedAt:ct?new Date(Number(ct)*1000).toISOString():null},title:articleTitle||htmlToText(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(clean)?.[1]||'')};
}
