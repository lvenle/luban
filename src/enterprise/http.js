import { suggestCreationPlan, confirmCreationPlan } from './plans.js';
import { AppError } from '../core/errors.js';
import { workspaceContext, canBuild, requireBuilder, appVisible, principal, isAdmin, projectFor, withWorkspace } from './context.js';
import { describeProject, publishProject, updateMembers } from './projects.js';
import { readJson, sendJson, serveUpload } from '../routes/_helpers.js';
import { getRuntimeSettings } from '../models/runtime-settings.js';
import { getApp } from '../models/app.js';

export async function enterpriseHttp(req,res,url) {
  if (!workspaceContext()) return false;
  const path=url.pathname,method=req.method||'GET',builder=workspaceContext().mode==='builder';
  if (builder) requireBuilder();
  if(path==='/api/workspace' && method==='GET') {
    sendJson(res,200,{enterprise:true,canBuild:canBuild(),userId:principal()?.userId,admin:isAdmin()});return true;
  }
  if(builder&&path==='/api/creation-plans'&&method==='POST') {
    const controller=new AbortController();res.on('close',()=>controller.abort());
    sendJson(res,200,await suggestCreationPlan(await readJson(req),{signal:controller.signal}));return true;
  }
  if(builder&&/^\/api\/creation-plans\/[^/]+\/confirm$/.test(path)&&method==='POST') {sendJson(res,201,confirmCreationPlan(path.split('/')[3],await readJson(req)));return true;}
  if(builder && /^\/api\/projects\/[^/]+(?:\/(?:publish|members|unpublish))?$/.test(path)) {
    const [, , ,id,action]=path.split('/');
    if(method==='GET'&&!action){sendJson(res,200,describeProject(id));return true;}
    if(method==='POST'&&action==='publish'){sendJson(res,200,publishProject(id,await readJson(req)));return true;}
    if(method==='PUT'&&action==='members'){updateMembers(id,(await readJson(req)).members);sendJson(res,200,{ok:true});return true;}
    if(method==='POST'&&action==='unpublish') {
      const {getDb,triggerBackup}=await import('../storage/db.js');const p=describeProject(id);
      if(!p.canPublish)throw new AppError(403,'没有下架权限');
      getDb().prepare("UPDATE enterprise_projects SET status='unpublished' WHERE id=?").run(p.id);triggerBackup();sendJson(res,200,{ok:true});return true;
    }
    throw new AppError(404,'API 不存在');
  }
  if (builder) {
    if(path==='/api/apps/generate')throw new AppError(409,'请先生成创建建议，确认应用名称、数据表和字段后再创建');
    if(path.startsWith('/api/files/')) {
      const suffix=path.slice('/api/files/'.length);
      if(!appVisible(decodeURIComponent(suffix.split('/')[0])))throw new AppError(404,'找不到资源');
      if(method!=='GET')throw new AppError(405,'只支持读取附件');
      serveUpload(res,'/uploads/'+suffix);return true;
    }
    if(path.includes('/scheduled-tasks') || path.includes('/rules/execute')) throw new AppError(409,'预览环境暂不支持执行定时任务或手动规则模拟');
    const dataMatch=path.match(/^\/api\/apps\/([^/]+)\/(records(?:\/.*)?|tables\/[^/]+\/records(?:\/.*)?)$/);
    if(dataMatch) {
      const project=projectFor(decodeURIComponent(dataMatch[1]));
      if(project?.draftId===decodeURIComponent(dataMatch[1])&&project.runtimeId&&project.releaseNumber>0) {
        if(method!=='GET') {
          const [draft,runtime]=withWorkspace({mode:'system'},()=>[getApp(project.draftId),getApp(project.runtimeId)]);
          if(JSON.stringify(draft.schema)!==JSON.stringify(runtime.schema))throw new AppError(409,'草稿数据结构尚未发布，请先发布后再编辑正式记录，避免新字段值无法保存');
        }
        workspaceContext().sharedDataAppId=project.runtimeId;
        const from=`/api/apps/${dataMatch[1]}/`,to=`/api/apps/${encodeURIComponent(project.runtimeId)}/`;
        req.url=req.url.replace(from,to);url.pathname=url.pathname.replace(from,to);
      }
    }
    return false;
  }
  if(path==='/api/settings' && method==='GET'){sendJson(res,200,{runtime:getRuntimeSettings()});return true;}
  if(path==='/api/health'||path==='/api/version'||path.startsWith('/api/auth/')) return false;
  if(path.startsWith('/uploads/')||path.startsWith('/html-preview/')) {
    const id=decodeURIComponent(path.split('/')[2]||'');
    // Preview attachments use the builder API endpoint as their access boundary.
    if(!appVisible(id))throw new AppError(404,'找不到资源');
    return false;
  }
  if(!path.startsWith('/api/')) {
    if(path.startsWith('/rules') && !/\.(?:css|js)$/.test(path))throw new AppError(403,'请在构建后台管理规则');
    return false;
  }
  if(path==='/api/apps' && method==='GET')return false;
  if(path.startsWith('/api/ai/') && !path.startsWith('/api/ai/generate-options'))return false; // Chat/tool/session guards validate the selected application.
  const match=path.match(/^\/api\/apps\/([^/]+)(?:\/(.*))?$/);
  if(match && appVisible(match[1])) {
    const suffix=match[2]||'';
    const release=req.headers['x-luban-release'];
    if(!['GET','HEAD'].includes(method) && release!==undefined && String(projectFor(match[1]).releaseNumber)!==release) throw new AppError(409,'应用已更新，请刷新后重试');
    const allowed=(!suffix&&method==='GET') || /^records(?:\/|$)/.test(suffix)
      || /^actions\/[^/]+\/run$/.test(suffix)&&method==='POST'
      || /^(export.csv|export.xlsx)$/.test(suffix)&&method==='GET'
      || suffix==='uploads'&&method==='POST'
      || /^scheduled-reminders(?:\/|$)/.test(suffix);
    if(allowed)return false;
  }
  throw new AppError(403,'此操作仅在有权限的构建后台开放');
}
