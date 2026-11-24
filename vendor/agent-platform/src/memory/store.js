import {readFile,open,rename,unlink,mkdir,rmdir,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
export const MEMORY_LIMIT = 25000;
const SECRET = /sk-[a-zA-Z0-9_-]{16,}|-----BEGIN .*PRIVATE KEY|(?:api[_ -]?key|password|密码|密钥)\s*[:：=]\s*\S{6,}/i;
const INDEX_START='<!-- task-index:start -->',INDEX_END='<!-- task-index:end -->';
export function bounded(text) {
  const bytes=Buffer.from(text.split('\n').slice(0,200).join('\n'));
  if(bytes.length<=MEMORY_LIMIT) return bytes.toString('utf8').trimEnd();
  let end=MEMORY_LIMIT;
  while((bytes[end]&0xc0)===0x80) end--;
  return bytes.subarray(0,end).toString('utf8').trimEnd();
}
function sections(text) {
  const entries=new Map(); let key=null, body=[], intro=[];
  for(const line of text.replace(/<!-- task-index:start -->[\s\S]*?<!-- task-index:end -->/g,'').split('\n')) {
    if(line.startsWith('## ')) {if(key) entries.set(key,body.join('\n').trim()); key=line.slice(3).trim(); body=[];}
    else if(key) body.push(line);
    else if(line.trim() && !line.startsWith("# ")) intro.push(line);
  }
  if(key) entries.set(key,body.join('\n').trim());
  if(intro.length) entries.set("补充笔记",intro.join("\n"));
  return entries;
}
export class MemoryStore {
  constructor(root, productName = 'Agent') {this.root=root;this.productName=productName;this.taskDirectory=null;}
  select(directory) {this.taskDirectory=directory;}
  path(scope) {
    if(scope!=='global' && scope!=='task') throw new Error('Unknown memory scope');
    const directory=scope==='global'?this.root:this.taskDirectory;
    if(!directory) throw new Error('No task selected');
    return join(directory,'MEMORY.md');
  }
  async raw(scope) {
    let handle;
    try {
      handle=await open(this.path(scope),constants.O_RDONLY|constants.O_NOFOLLOW);
      const stat=await handle.stat(); if(!stat.isFile() || stat.size>500000) throw new Error('记忆文件过大或不是普通文件，请整理后重试。');
      return await handle.readFile('utf8');
    } catch(e) {if(e.code==='ENOENT') return '';throw e;} finally {await handle?.close();}
  }
  async read(scope) {
    const raw=await this.raw(scope), text=bounded(raw).replace(new RegExp(SECRET.source,"ig"),"[疑似凭据已隐藏]");
    return {scope,path:this.path(scope),text,truncated:raw.trimEnd()!==text};
  }
  async edit(scope,transform) {
    const path=this.path(scope),lock=path+'.lock';
    let acquired=false;
    for(let i=0;i<50;i++) {
      try {await mkdir(lock,{mode:0o700});acquired=true;break;} catch(e) {if(e.code!=='EEXIST') throw e;await delay(20);}
    }
    if(!acquired) throw new Error('记忆文件正在使用或上次保存被中断，请检查 MEMORY.md.lock 后重试。');
    const temp=path+'.'+randomUUID()+'.tmp';
    try {
      const raw=await this.raw(scope),next=transform(raw);
      if(next===raw) return;
      if(next.split('\n').length>200 || Buffer.byteLength(next)>MEMORY_LIMIT) throw new Error('记忆已达到 200 行或 25 KB，请先合并、精简或忘记过期条目。原文件未改动。');
      if(SECRET.test(next)) throw new Error('记忆中包含疑似凭据，未保存。');
      const handle=await open(temp,'wx',0o600);
      try {await handle.writeFile(next);await handle.sync();} finally {await handle.close();}
      const info=await lstat(path).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});
      if(info?.isSymbolicLink()) throw new Error('记忆不能写入符号链接');
      await rename(temp,path);
    } finally {await unlink(temp).catch(()=>{});await rmdir(lock);}
  }
  async update(scope,topic,content,{userText='',automatic=false}={}) {
    topic=topic.trim();content=content.trim();
    if(automatic) content=content.replace(/^## /gm,"### ");
    if(!topic || topic.length>60 || /[\r\n<>]/.test(topic) || !content || content.length>1800 || /^## /m.test(content) || content.includes('<!--')) throw new Error('记忆主题或内容格式无效');
    if(SECRET.test(content)) throw new Error('不能将凭据保存为记忆');
    if(!automatic && !userText.includes(content)) throw new Error('记忆内容必须是本轮用户原话的连续片段，不可编造或从网页摘取');
    if(!automatic && topic==='任务进度') throw new Error('任务进度由整理器维护，请使用其他主题');
    await this.edit(scope,raw=> {
      const entries=sections(raw);entries.set(topic,content);
      const index=raw.match(/<!-- task-index:start -->[\s\S]*?<!-- task-index:end -->/)?.[0] ?? '';
      return this.render(scope,entries,index);
    });
    return {saved:true,scope,topic,path:this.path(scope)};
  }
  render(scope,entries,index='') {
    return '# '+(scope==='global'?this.productName+'全局记忆':'任务记忆')+'\n\n'+[...entries].map(([key,value])=>'## '+key+'\n'+value+'\n').join('\n')+(index?'\n'+index+'\n':'');
  }
  async forget(scope,topic,userText) {
    if(!/忘记|忘掉|删除.*记忆|清除.*记忆|不要再记|不再记住/.test(userText)) throw new Error('需要用户明确要求忘记或删除记忆');
    await this.edit(scope,raw=> {
      const entries=sections(raw);
      if(!entries.delete(topic)) throw new Error('未找到该主题，请先读取记忆核对主题名称');
      return this.render(scope,entries,raw.match(/<!-- task-index:start -->[\s\S]*?<!-- task-index:end -->/)?.[0] ?? '');
    });
    return {forgotten:true,scope,topic,note:'已删除长期记忆条目；已有聊天和任务产物仍保留。本轮不再自动整理记忆。'};
  }
  async index(catalog) {
    const rows=(catalog.tasks??[]).filter(t=>t.folder && !SECRET.test(t.title+t.folder)).slice(-40).map(t=>'- '+String(t.title).replace(/[\r\n]/g,' ').slice(0,50)+' → '+t.folder+'/MEMORY.md');
    await this.edit('global',raw=> {
      const index=INDEX_START+'\n'+rows.join('\n')+'\n'+INDEX_END;
      const prefix=raw.replace(/<!-- task-index:start -->[\s\S]*?<!-- task-index:end -->\n?/g,'').trimEnd();
      return (prefix || '# '+this.productName+'全局记忆')+'\n\n'+index+'\n';
    });
  }
}
