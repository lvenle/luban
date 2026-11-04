import { randomUUID } from 'node:crypto';
import { getDb, withTransaction, triggerBackup } from '../storage/db.js';
import { createAppFromPackage } from '../models/app.js';
import { preparePackage } from '../core/packageProtocol.js';
import { AppError } from '../core/errors.js';
import { principal, requireBuilder, withWorkspace, workspaceContext } from './context.js';
import { completeWithLubanProvider, requireLubanModel } from '../agent/non-chat-provider.js';
import { getSetting } from '../models/session.js';
export const PLAN_FIELD_TYPES=['text','textarea','number','date','datetime','select','multiSelect','file','image'];
function text(value,label,max=100) {
  if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw new AppError(400,`${label}不能为空且不能超过 ${max} 个字符`);
  return value.trim();
}
export function normalizePlan(input) {
  if(!input||!Array.isArray(input.tables)||input.tables.length<1||input.tables.length>20)throw new AppError(400,'请选择 1 至 20 张数据表');
  if(input.tables.some(t=>!t||typeof t!=='object'||!Array.isArray(t.fields)||t.fields.some(f=>!f||typeof f!=='object')))throw new AppError(400,'数据表和字段格式不完整');
  const tables=input.tables.filter(t=>t.selected!==false).map(table=>({
    name:text(table.name,'表名',50),selected:true,
    fields:(Array.isArray(table.fields)?table.fields:[]).map(field=>{
      if(!PLAN_FIELD_TYPES.includes(field.type))throw new AppError(400,'请选择支持的字段类型');
      const options=['select','multiSelect'].includes(field.type)?(Array.isArray(field.options)?field.options:[]).map(v=>text(v,'选项',80)):undefined;
      if(options&&(options.length<1||options.length>50||new Set(options).size!==options.length))throw new AppError(400,'选择字段需要 1 至 50 个不重复的选项');
      return {label:text(field.label,'字段名',50),type:field.type,...(options?{options}:{})};
    })
  }));
  if(!tables.length||tables.some(t=>!t.fields.length||t.fields.length>50||new Set(t.fields.map(f=>f.label)).size!==t.fields.length)||new Set(tables.map(t=>t.name)).size!==tables.length)throw new AppError(400,'请保留至少一张表，每张表需要 1 至 50 个不重名的字段，表名也不能重复');
  return {name:text(input.name,'应用名称',80),description:String(input.description||'').trim().slice(0,1000),tables};
}
export function initializePlans() {
  getDb().exec(`CREATE TABLE IF NOT EXISTS enterprise_creation_plans(
    id TEXT PRIMARY KEY,ownerId TEXT NOT NULL,scopeId TEXT NOT NULL,prompt TEXT NOT NULL,
    proposal TEXT NOT NULL,confirmed TEXT,createdAppId TEXT,expiresAt INTEGER NOT NULL);`);
}
export async function suggestCreationPlan(input,{generate=generateSuggestion,signal}={}) {
  requireBuilder();
  const prompt=text(input.prompt,'应用需求',8000);
  const proposal=normalizePlan(input.manual?{name:'我的业务应用',description:prompt,tables:[{name:'业务记录',fields:[{label:'名称',type:'text'},{label:'备注',type:'textarea'}]}]}:await generate(prompt,signal));
  signal?.throwIfAborted();
  const user=principal(),id=randomUUID(),expiresAt=Date.now()+30*60*1000;
  getDb().prepare('INSERT INTO enterprise_creation_plans(id,ownerId,scopeId,prompt,proposal,expiresAt) VALUES(?,?,?,?,?,?)').run(id,user.userId,user.scopeId,prompt,JSON.stringify(proposal),expiresAt);
  triggerBackup();
  return {requiresConfirmation:true,planId:id,proposal,expiresAt};
}
async function generateSuggestion(prompt,signal) {
  const settings=getSetting('ai')||{};await requireLubanModel(settings);
  const output=await completeWithLubanProvider(settings,{signal,maxTokens:5000,messages:[
    {role:'system',content:'你只负责提出应用构建建议，不能执行创建。只输出 JSON：{"name":"建议应用名称","description":"用途","tables":[{"name":"表名","fields":[{"label":"字段名","type":"text"}]}]}。依据用户需求建议最少必要的数据表和基本字段。字段类型只允许 '+PLAN_FIELD_TYPES.join(',')+'；select/multiSelect 必须提供 options 字符串数组。不要添加未确认的审批、定时任务、外部调用或数据。每张表至少一个 text 名称字段。用户之后可修改和勾选方案，建议不等于已创建。'},
    {role:'user',content:prompt}
  ]});
  try {return JSON.parse(output.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch {throw new AppError(422,'AI 建议格式不完整，请重新生成，或选择手动填写');}
}
export function confirmCreationPlan(planId,input) {
  requireBuilder();
  if(input.confirmed!==true)throw new AppError(400,'请先检查应用名称、数据表和字段，再明确确认创建');
  const proposal=normalizePlan(input.proposal),user=principal();
  return withTransaction(()=>{
    const row=getDb().prepare('SELECT * FROM enterprise_creation_plans WHERE id=? AND ownerId=? AND scopeId=?').get(planId,user.userId,user.scopeId);
    if(!row)throw new AppError(404,'找不到当前用户的创建建议');
    if(row.createdAppId)throw new AppError(409,'这份方案已创建应用，请打开已有草稿');
    if(row.expiresAt<Date.now())throw new AppError(409,'建议已过期，请重新生成或填写');
    const entities=proposal.tables.map((t,i)=>({id:'entity_'+(i+1),name:t.name,fields:t.fields.map((f,j)=>({id:'field_'+(j+1),label:f.label,type:f.type,...(f.options?{options:f.options}:{})}))}));
    const pkg=preparePackage({manifest:{name:proposal.name,description:proposal.description,version:'1.0.0'},schema:{entities},ui:{pages:entities.map((e,i)=>({id:'page_'+(i+1),title:e.name,type:'table',entity:e.id}))},actions:{actions:[]},prompts:{}});
    const app=withWorkspace({...workspaceContext(),creationAuthorized:true},()=>createAppFromPackage(pkg));
    getDb().prepare('UPDATE enterprise_creation_plans SET confirmed=?,createdAppId=? WHERE id=?').run(JSON.stringify(proposal),app.id,planId);
    triggerBackup();return {appId:app.id,app};
  });
}
