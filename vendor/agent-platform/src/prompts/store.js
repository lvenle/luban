import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';

export const PROMPT_CATEGORIES=['写作与翻译','软件开发','数据分析','产品与设计','营销与商业','办公与效率','学习与教育','生活与创意','工具与集成','其他'];
const variablePattern=/\{\{\s*([a-zA-Z_\u4e00-\u9fff][\w\u4e00-\u9fff-]{0,63})\s*\}\}/g;
export const promptVariables=body=>[...new Set([...String(body||'').matchAll(variablePattern)].map(m=>m[1]))];
const digest=text=>createHash('sha256').update(text.replace(/\s+/g,' ').trim().toLowerCase()).digest('hex');
function fail(message,status=400){const e=Error(message);e.status=status;throw e}
function text(value,max,name,required=false){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))fail(`${name}${required?'不能为空，且':''}最多 ${max} 个字符`);return value.trim()}
export function normalizePrompt(input){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('提示词格式无效');
 const body=text(input.body,250000,'中文正文',true);
 if(!['prompt','reference'].includes(input.kind||'prompt'))fail('提示词类型无效');
 if(!Array.isArray(input.tags||[])||(input.tags||[]).length>20)fail('标签最多 20 个');
 if(!Array.isArray(input.sources||[])||(input.sources||[]).length>30)fail('来源最多 30 个');
 const sources=(input.sources||[]).map(s=>{if(!s||typeof s!=='object')fail('来源格式无效');let url;try{url=new URL(s.url)}catch{fail('来源链接无效')}if(!['http:','https:'].includes(url.protocol)||url.username||url.password)fail('来源必须是 HTTP 或 HTTPS 链接');return {repository:text(s.repository||'',200,'来源仓库'),url:url.href,path:text(s.path||'',500,'来源路径'),commit:text(s.commit||'',100,'来源版本'),license:text(s.license||'unspecified',200,'许可证')};});
 return {title:text(input.title,160,'名称',true),description:text(input.description||'',2000,'用途'),category:text(input.category||'其他',80,'分类',true),tags:[...new Set((input.tags||[]).map(t=>text(t,60,'标签',true)))],body,original:text(input.original||'',250000,'原文'),kind:input.kind||'prompt',dependencies:text(input.dependencies||'',2000,'运行依赖'),translationStatus:text(input.translationStatus||'native',80,'翻译状态'),sources,variables:promptVariables(body),example:text(input.example||'',8000,'示例'),selectionReason:text(input.selectionReason||'',4000,'择优说明')};
}
export function renderPrompt(prompt,{language='zh',variables={},input=''}={}){
 if(!['zh','original'].includes(language))fail('语言无效');
 const body=language==='original'?prompt.original:prompt.body;if(!body)fail('该提示词没有英文原文');
 if(!variables||typeof variables!=='object'||Array.isArray(variables))fail('变量格式无效');
 for(const key of promptVariables(body)){if(typeof variables[key]!=='string'||!variables[key].trim())fail(`请填写变量：${key}`);if(variables[key].length>50000)fail(`变量 ${key} 超过长度限制`)}
 const rendered=body.replace(variablePattern,(_,key)=>variables[key]);
 const extra=text(input,50000,'补充输入');const output=rendered+(extra?'\n\n用户提供的资料与具体要求：\n'+extra:'');if(output.length>300000)fail('本次输入过长');return output;
}
export class PromptStore{
 constructor(db,{seedFile=new URL('./catalog.json',import.meta.url)}={}){
  this.db=db;db.exec(`CREATE TABLE IF NOT EXISTS prompt_entries(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,data TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS prompt_versions(prompt_id TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(prompt_id,revision));
   CREATE TABLE IF NOT EXISTS prompt_runs(run_id TEXT PRIMARY KEY,prompt_id TEXT NOT NULL,revision INTEGER NOT NULL,owner TEXT NOT NULL,language TEXT NOT NULL,created_at TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS prompt_runs_entry ON prompt_runs(prompt_id,owner,created_at);`);
  if(seedFile&&existsSync(seedFile)){const seed=JSON.parse(readFileSync(seedFile,'utf8'));const seenBodies=new Set(this.all().map(item=>digest(item.body)));this.transaction(()=>{for(const item of seed.items||[]){const fingerprint=digest(item.body);if(this.row(item.id,true)||seenBodies.has(fingerprint))continue;this.insert(item,item.id);seenBodies.add(fingerprint)}})}
 }
 transaction(fn){this.db.exec('SAVEPOINT prompt_mutation');try{const value=fn();this.db.exec('RELEASE prompt_mutation');return value}catch(e){this.db.exec('ROLLBACK TO prompt_mutation; RELEASE prompt_mutation');throw e}}
 row(id,includeDeleted=false){return this.db.prepare(`SELECT * FROM prompt_entries WHERE id=?${includeDeleted?'':' AND deleted=0'}`).get(id)}
 unpack(row){if(!row)fail('提示词不存在',404);return {...JSON.parse(row.data),id:row.id,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at}}
 get(id){return this.unpack(this.row(id))}
 all(){return this.db.prepare('SELECT * FROM prompt_entries WHERE deleted=0 ORDER BY updated_at DESC,id').all().map(r=>this.unpack(r))}
 list(query={}){const all=this.all();const q=String(query.q||'').trim().toLowerCase();const matches=all.filter(p=>(!query.category||p.category===query.category)&&(!query.kind||p.kind===query.kind)&&(!q||[p.title,p.description,p.body,p.original,...p.tags,...(p.sources||[]).flatMap(source=>[source.repository,source.url,source.path])].some(s=>String(s||'').toLowerCase().includes(q))));matches.sort((a,b)=>Number(Boolean(b.sources?.length||(b.tags||[]).includes('AI-DB方法')))-Number(Boolean(a.sources?.length||(a.tags||[]).includes('AI-DB方法'))));const page=Math.max(1,Number.parseInt(query.page)||1),pageSize=Math.max(1,Math.min(100,Number.parseInt(query.pageSize)||24));const categories=[...new Set([...PROMPT_CATEGORIES,...all.map(p=>p.category)])].map(name=>({name,count:all.filter(p=>p.category===name).length}));return {items:matches.slice((page-1)*pageSize,page*pageSize).map(({body,original,...item})=>({...item,hasOriginal:Boolean(original)})),total:matches.length,count:all.length,categories,page,pageSize};}
 insert(input,id=randomUUID()){if(!/^[\w-]{1,100}$/.test(id))fail('提示词 ID 无效');const data=normalizePrompt(input),now=new Date().toISOString();this.db.prepare('INSERT INTO prompt_entries(id,revision,data,created_at,updated_at) VALUES(?,1,?,?,?)').run(id,JSON.stringify(data),now,now);this.db.prepare('INSERT INTO prompt_versions VALUES(?,?,?,?)').run(id,1,JSON.stringify(data),now);return this.get(id)}
 create(input){return this.transaction(()=>this.insert(input))}
 checkRevision(item,revision){if(!Number.isInteger(revision)||item.revision!==revision)fail('内容已更新，请重新加载后再保存',409)}
 update(id,input){return this.transaction(()=>{const previous=this.get(id);this.checkRevision(previous,input.revision);const data=normalizePrompt(input),now=new Date().toISOString(),revision=previous.revision+1;this.db.prepare('UPDATE prompt_entries SET data=?,revision=?,updated_at=? WHERE id=?').run(JSON.stringify(data),revision,now,id);this.db.prepare('INSERT INTO prompt_versions VALUES(?,?,?,?)').run(id,revision,JSON.stringify(data),now);return this.get(id)})}
 delete(id,revision){const item=this.get(id);this.checkRevision(item,revision);this.db.prepare('UPDATE prompt_entries SET deleted=1 WHERE id=?').run(id);return {id,deleted:true}}
 versions(id){this.get(id);return this.db.prepare('SELECT revision,data,created_at FROM prompt_versions WHERE prompt_id=? ORDER BY revision DESC').all(id).map(r=>({...JSON.parse(r.data),revision:r.revision,createdAt:r.created_at}))}
 restore(id,{version,revision}){const target=this.versions(id).find(v=>v.revision===version);if(!target)fail('历史版本不存在',404);return this.update(id,{...target,revision})}
 import(input){if(!Array.isArray(input.items)||input.items.length>2000)fail('请提供最多 2000 条提示词的 items 数组');const items=input.items.map(normalizePrompt);return this.transaction(()=>{const seen=new Set(this.all().map(p=>digest(p.body)));let imported=0,skipped=0;for(const item of items){const fingerprint=digest(item.body);if(seen.has(fingerprint)){skipped++;continue}this.insert(item);seen.add(fingerprint);imported++}return {imported,skipped}})}
 export(){return {schemaVersion:1,exportedAt:new Date().toISOString(),items:this.all()}}
 recordRun(id,revision,owner,language,runId){this.db.prepare('INSERT INTO prompt_runs VALUES(?,?,?,?,?,?)').run(runId,id,revision,owner,language,new Date().toISOString())}
 history(id,owner){this.get(id);return this.db.prepare('SELECT run_id AS runId,revision,language,created_at AS createdAt FROM prompt_runs WHERE prompt_id=? AND owner=? ORDER BY created_at DESC LIMIT 30').all(id,owner)}
}
