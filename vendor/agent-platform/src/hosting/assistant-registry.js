import {applicationRequestContext} from './request-context.js';
/** Holds trusted in-process adapters; never accepts paths or service URLs from clients. */
export function createAssistantRegistry({authorize}={}) {
 const entries=new Map();
 function allowed(id){const current=applicationRequestContext();return !current || authorize?.(current.identity,id,'manage')===true}
 function entry(id){const value=entries.get(id);if(!value){const error=Error('Application assistant not found');error.status=404;throw error}if(!allowed(id)){const error=Error('当前用户无权管理此应用助手');error.status=403;throw error}return value}
 return {
  register(id,title,adapter){if(entries.has(id)||!adapter?.snapshot||!adapter?.save)throw Error('Invalid or duplicate application assistant adapter');entries.set(id,{title,adapter})},
  list(){return [...entries].filter(([id])=>allowed(id)).map(([id,{title,adapter}])=>({id,title,...adapter.snapshot()}))},
  get(id){return entry(id).adapter.snapshot()},
  save(id,input){return entry(id).adapter.save(input)}
 };
}
export function storeAssistantAdapter(store,id){return {
 snapshot(){const state=store.snapshot(),agent=store.getApplicationAssistant(id);return {modelsManaged:Boolean(store.modelsManaged),applicationInstanceId:id,assistantId:agent.id,revision:state.revision,system:agent.system,connection:state.connections.find(c=>c.id===(store.modelsManaged?state.defaultConnectionId:(agent.connectionId||state.defaultConnectionId)))||null}},
 async save(input){if(!Number.isInteger(input?.revision))throw Error('配置修订不能为空，请重新打开助手设置');await store.saveApplicationSettings(id,{connection:input.connection,system:input.system},input.revision);return this.snapshot()}
}}
