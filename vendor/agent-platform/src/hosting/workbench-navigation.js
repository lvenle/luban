const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function target(value){
 if(typeof value!=='string'||!value||/[\s<>"'\\]/.test(value))throw Error('Invalid workbench navigation target');
 if(/^\/(?!\/)[a-zA-Z0-9/_.-]*$/.test(value))return value;
 const url=new URL(value);
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('Invalid workbench navigation target');
 return url.href;
}
export function workbenchNavigationOptions(input={}){
 const platformBase=target(input.platformBase||'/platform/');
 if(!platformBase.endsWith('/'))throw Error('Workbench platform base must end in /');
 return {platformBase,knowledge:input.knowledge!==false,prompts:input.prompts!==false,...(input.lubanHref?{lubanHref:target(input.lubanHref)}:{}),wechatHref:input.wechatHref===null?null:target(input.wechatHref||'/wechat/'),dbHref:input.dbHref===null?null:target(input.dbHref||'/ai-db/'),adminHref:target(input.adminHref||platformBase+'models/basic')};
}
export function workbenchNavigationEntries(input={}){
 const options=workbenchNavigationOptions(input);
 return [
  {id:'conversation',label:'会话',href:options.platformBase+'conversation'},
  ...(options.knowledge?[{id:'library',label:'知识库',href:options.platformBase+'library'}]:[]),
  ...(options.prompts?[{id:'prompts',label:'提示词库',href:options.platformBase+'prompts'}]:[]),
  ...(options.dbHref?[{id:'ai-db',label:'AI-DB',href:options.dbHref}]:[]),
  ...(options.lubanHref?[{id:'luban',label:'应用中心',href:options.lubanHref}]:[])
 ];
}
export function readWorkbenchNavigation(doc=globalThis.document){
 const content=doc?.querySelector('meta[name="workbench-navigation"]')?.content;
 return workbenchNavigationOptions(content?JSON.parse(content):{});
}
export function workbenchNavigationMeta(input){
 return '<meta name="workbench-navigation" content="'+escape(JSON.stringify(workbenchNavigationOptions(input)))+'">';
}
export function renderWorkbenchNavigation({active,...input}={}){
 const options=workbenchNavigationOptions(input),entries=workbenchNavigationEntries(options);
 return `<header class="workbench-topbar"><strong class="workbench-brand">AI工作台</strong><nav class="workbench-menu" aria-label="应用导航">${entries.map(entry=>`<a class="workbench-link${entry.id===active?' active':''}" data-workbench-page="${entry.id}" href="${escape(entry.href)}"${entry.id===active?' aria-current="page"':''}>${entry.label}</a>`).join('')}</nav><a class="workbench-admin" data-workbench-page="admin" href="${escape(options.adminHref)}">平台后台</a></header>`;
}
