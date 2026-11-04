import { openCreationDialog } from './creation.js';
import { h } from '../common/dom.js';
import { api } from '../common/api.js';
import { toast } from '../common/toast.js';
import { applicationPath } from '../common/application-base.js';
import { enterpriseUi, builderUi, switchWorkspace, openSettingsPage, navigateWorkspace } from '../common/workspace.js';
import { state, root, topbar } from '../app-context.js';
import { pageNavKind, pageTypeIcon } from '../app-runtime/Sidebar.js';
import { appCard } from '../app-home/AppCard.js';
import { setAssistantMode, renderAssistantDrawer, removeAssistantDrawer } from '../ai-assistant/index.js';

const navIcons={'应用管理':'▦','构建与预览':'◉','业务规则':'☷','发布管理':'⇧','助手设置':'✦','系统设置':'◎','前台入口':'←','后台入口':'⚙'};
function link(text,action,active=false) {return h('button',{class:`builder-nav-item ${active?'active':''}`,onclick:action},[h('span',{class:'builder-nav-icon','aria-hidden':'true',text:navIcons[text]||'·'}),h('span',{text})]);}
const groupLabel=text=>h('div',{class:'builder-nav-section',text});
export function navigation() {
  const app=state.currentApp;
  const builder=builderUi();
  if(!builder) {
    const pages=app?.ui?.pages||[];
    const availableApps=state.apps.filter(item=>item.enabled!==false);
    const select=h('select',{id:'business-app-select','aria-label':'选择业务应用',onchange:event=>navigateWorkspace(event.target.value?'/app/'+encodeURIComponent(event.target.value):'/')},[
      h('option',{value:'',text:availableApps.length?'选择应用':'暂无可用应用'}),
      ...availableApps.map(item=>h('option',{value:item.id,text:item.name}))
    ]);
    select.value=app?.id||'';
    return h('aside',{class:'builder-rail business-navigation','aria-label':'业务应用菜单'},[
      h('div',{class:'business-app-selector'},[h('label',{for:'business-app-select',text:'应用'}),select]),
      h('div',{class:'business-menu-heading'},[h('h2',{text:'应用菜单'}),h('span',{class:'business-menu-count',text:String(pages.length)})]),
      h('nav',{class:'business-page-list','aria-label':'应用页面'},pages.length?pages.map(page=>h('button',{
        class:`business-page-item ${page.id===state.currentPageId?'active':''}`,
        ...(page.id===state.currentPageId?{'aria-current':'page'}:{}),
        onclick:()=>{
          if(pageNavKind(app,page)==='link' && page.url && page.target!=='_self'){window.open(page.url,'_blank','noopener');return;}
          navigateWorkspace('/app/'+encodeURIComponent(app.id)+'/page/'+encodeURIComponent(page.id));
        }
      },[h('span',{class:'business-page-icon','aria-hidden':'true'},[pageTypeIcon(pageNavKind(app,page))]),h('span',{text:page.title})])):[h('p',{class:'business-menu-empty',text:app?'此应用暂无菜单':'选择应用后显示菜单'})]),
      state.workspace?.canBuild?h('div',{class:'builder-rail-bottom'},[h('span',{class:'builder-profile-avatar','aria-hidden':'true',text:'▦'}),h('div',{class:'builder-profile-copy'},[link('后台入口',()=>switchWorkspace(true)),h('small',{text:'切换到应用后台'})])]):null
    ]);
  }
  const settingsKind=applicationPath().match(/\/settings\/(assistant|system)\/?$/)?.[1];
  return h('aside',{class:'builder-rail','aria-label':'应用构建后台'},[
    h('div',{class:'builder-rail-brand',text:'构建后台'}),
    groupLabel('应用'),
    link('应用管理',()=>navigateWorkspace('/builder/'),!settingsKind),
    groupLabel('设置'),
    link('助手设置',()=>openSettingsPage('assistant'),settingsKind==='assistant'),
    ...(state.workspace?.admin?[link('系统设置',()=>openSettingsPage('system'),settingsKind==='system')]:[]),
    h('div',{class:'builder-rail-bottom'},[h('span',{class:'builder-profile-avatar','aria-hidden':'true',text:'▦'}),h('div',{class:'builder-profile-copy'},[link('前台入口',()=>switchWorkspace(false)),h('small',{text:'切换到应用前台'})])])
  ]);
}
export function decorateBuilder() {
  if(!enterpriseUi())return;
  const shell=root.querySelector('.shell');if(!shell)return;
  shell.classList.add('builder-shell');
  shell.prepend(navigation());
  if(builderUi() && state.currentApp) {
    const app=state.currentApp;
    const select=h('select',{'aria-label':'切换构建应用',onchange:event=>import('../app-runtime/index.js').then(runtime=>runtime.openApp(event.target.value)).catch(error=>toast(error.message))},state.apps.map(item=>h('option',{value:item.id,text:item.name})));
    select.value=app.id;
    const tools=h('nav',{class:'builder-app-navigation','aria-label':'当前应用操作'},[
      h('label',{class:'builder-app-switcher'},[h('span',{text:'当前应用'}),select]),
      h('div',{class:'builder-app-tabs'},[
        h('button',{class:'chip active','aria-current':'page',text:'构建与预览',onclick:()=>{}}),
        h('button',{class:'chip',text:'业务规则',onclick:()=>import('../app-runtime/SettingsModal.js').then(m=>m.openSettingsModal(app.id,'rules'))}),
        h('button',{class:'chip',text:'发布管理',onclick:()=>releaseDialog(app).catch(e=>toast(e.message))})
      ])
    ]);
    shell.querySelector('.enterprise-context-bar')?.append(tools);
  }
}
export function renderEnterpriseHome() {
  const builder=builderUi();
  setAssistantMode({mode:'create'});
  root.innerHTML='';
  const search=h('input',{type:'search',placeholder:'搜索应用…','aria-label':'搜索应用'});
  const grid=h('div',{class:'grid'});
  let publicationFilter='all';
  const filters=h('div',{class:'publication-filters','aria-label':'发布状态筛选'});
  if(builder) for(const [value,label] of [['all','全部'],['draft','未发布'],['published','已发布'],['unpublished','已下架']]) {
    const count=value==='all'?state.apps.length:state.apps.filter(app=>app.publicationStatus===value).length;
    filters.append(h('button',{class:`chip ${value==='all'?'active':''}`,text:`${label} ${count}`,'aria-pressed':String(value==='all'),onclick:event=>{publicationFilter=value;for(const button of filters.children){button.classList.toggle('active',button===event.currentTarget);button.setAttribute('aria-pressed',String(button===event.currentTarget));}draw();}}));
  }
  const empty=h('div',{class:'enterprise-empty'},[
    h('strong',{text:builder?'还没有应用草稿':'暂无可用的业务应用'}),
    h('p',{text:builder?'使用 AI 创建应用，或导入已有软件包开始构建。':'已发布且授权给你的应用会显示在这里。'})
  ]);
  function draw(){
    grid.innerHTML='';
    const visibleApps=builder?state.apps:state.apps.filter(app=>app.enabled!==false);
    const apps=visibleApps.filter(app=>`${app.name} ${app.description}`.toLowerCase().includes(search.value.toLowerCase()) && (!builder || publicationFilter==='all' || app.publicationStatus===publicationFilter));
    for(const app of apps) grid.append(appCard(app,{readOnly:!builder,showPublication:builder}));
    if(visibleApps.length) {
      empty.querySelector('strong').textContent='没有符合条件的应用';
      empty.querySelector('p').textContent='试试其他搜索词或发布状态。';
    }
    empty.hidden=apps.length>0;
  }
  search.addEventListener('input',draw);draw();
  const main=h('main',{class:'container enterprise-app-center'},[
    h('section',{class:'enterprise-hero'},[
      h('div',{},[h('h1',{text:builder?'应用管理':'业务应用'}),h('p',{text:builder?'构建草稿、独立测试，发布后供业务人员使用。':'选择应用，开始处理业务。'})]),
      builder?h('div',{class:'toolbar'},[
        h('button',{class:'secondary assistant-topbar-button',text:'构建助手',onclick:()=>{state.assistantOpen=!state.assistantOpen;renderEnterpriseHome();}}),
        h('button',{class:'primary',text:'创建应用',onclick:()=>openCreationDialog()}),
        h('button',{class:'secondary',text:'导入 .sgpkg',onclick:()=>import('../app-home/ImportModal.js').then(m=>m.openImportModal())})
      ]):null
    ]),h('div',{class:'builder-page-content'},[h('section',{class:'enterprise-list-panel'},[h('div',{class:'enterprise-list-heading'},[h('h2',{text:builder?'全部应用':'已发布应用'}),search]),filters,grid,empty])])
  ]);
  root.append(h('div',{class:'shell enterprise-home-shell builder-shell'},[navigation(),topbar(),main]));
  if(builder&&state.assistantOpen)renderAssistantDrawer(()=>{state.assistantOpen=false;});else removeAssistantDrawer();
}
function dialog(title) {
  const backdrop=h('div',{class:'modal-backdrop'});
  const content=h('div',{class:'modal builder-dialog',role:'dialog','aria-modal':'true','aria-label':title},[
    h('div',{class:'toolbar'},[h('h2',{text:title}),h('button',{class:'ghost',text:'关闭',onclick:()=>backdrop.remove()})])
  ]);backdrop.append(content);document.body.append(backdrop);return {backdrop,content};
}
export async function releaseDialog(app) {
  const project=await api(`/api/projects/${app.id}`);
  const {backdrop,content}=dialog('发布管理');
  content.append(h('p',{text:`${app.name} · ${project.releaseNumber?'线上 V'+project.releaseNumber:'尚未发布'} · ${project.hasChanges?'有待发布修改':'草稿与已发布版本一致'}`}),
    h('p',{class:'muted',text:'仅发布应用定义和规则；测试记录不会进入正式环境。当前只支持保持数据结构不变的升级。'}));
  const status=h('p',{role:'status'});content.append(status);
  if(project.canPublish){
    const publish=h('button',{class:'primary',text:project.releaseNumber?'发布新版本':'首次发布',onclick:async()=>{
      publish.disabled=true;
      try{const r=await api(`/api/projects/${app.id}/publish`,{method:'POST',body:JSON.stringify({revision:project.revision,releaseNumber:project.releaseNumber})});backdrop.remove();toast(`V${r.number} 已发布`);await refreshApplicationList();await releaseDialog(app);}catch(e){status.textContent=e.message;publish.disabled=false;}
    }});content.append(publish);
    if(project.status==='published')content.append(h('button',{class:'secondary',text:'下架应用',onclick:async()=>{try{await api(`/api/projects/${app.id}/unpublish`,{method:'POST',body:'{}'});backdrop.remove();toast('应用已下架');await refreshApplicationList();}catch(e){status.textContent=e.message;}}}));
  }
  content.append(h('h3',{text:'发布历史'}),h('div',{class:'release-history'},project.releases.length?project.releases.map(r=>h('div',{class:'release-history-row'},[h('strong',{text:`V${r.number}`}),h('span',{text:new Date(r.createdAt).toLocaleString()})])):[h('p',{class:'muted',text:'暂无发布记录'})]));
}
export async function membersDialog(app) {
  const project=await api(`/api/projects/${app.id}`);const {content,backdrop}=dialog('成员权限');
  content.append(h('p',{class:'muted',text:'应用负责人和企业管理员可管理应用。使用者需要企业统一用户 ID；构建者另需模块管理权限。'}));
  const rows=h('div');const members=project.members.map(m=>({...m}));
  const draw=()=>{rows.innerHTML='';members.forEach((m,i)=>{const id=h('input',{value:m.userId,placeholder:'企业用户 ID','aria-label':'企业用户 ID',oninput:e=>m.userId=e.target.value});const role=h('select',{'aria-label':'成员角色'},[['user','使用者'],['builder','构建者'],['publisher','发布者']].map(([value,text])=>h('option',{value,text})));role.value=m.role;role.onchange=()=>m.role=role.value;rows.append(h('div',{class:'toolbar'},[id,role,h('button',{text:'移除',onclick:()=>{members.splice(i,1);draw();}})]));});};draw();content.append(rows);
  if(project.canManageMembers)content.append(h('button',{class:'secondary',text:'添加成员',onclick:()=>{members.push({userId:'',role:'user'});draw();}}),h('button',{class:'primary',text:'保存授权',onclick:async()=>{try{await api(`/api/projects/${app.id}/members`,{method:'PUT',body:JSON.stringify({members})});backdrop.remove();toast('应用授权已保存');}catch(e){toast(e.message);}}}));
}

async function refreshApplicationList(){
  if(state.currentApp)return;
  state.apps=(await api('/api/apps')).apps;
  renderEnterpriseHome();
}
