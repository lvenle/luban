import { AsyncLocalStorage } from 'node:async_hooks';
import { applicationRequestContext } from '@xiaoya/agent-platform/hosting/context';
import { getDb } from '../storage/db.js';
import { AppError } from '../core/errors.js';
const context = new AsyncLocalStorage();
export const workspaceContext = () => context.getStore();
export const withWorkspace = (value, callback) => context.run(value, callback);
export const isBuilder = () => workspaceContext()?.mode === 'builder';
export const isEnterprise = () => Boolean(workspaceContext());
export const principal = () => applicationRequestContext()?.identity;
export const isAdmin = () => principal()?.role === 'admin';
export function canBuild() {
  const user = principal();
  return Boolean(user && (isAdmin() || user.grants?.includes('luban:manage')));
}
export function requireBuilder() {
  if (isEnterprise() && workspaceContext().mode !== 'system' && (!isBuilder() || !canBuild())) throw new AppError(403, '请在有权限的构建后台操作');
}
export function projectFor(appId) {
  return getDb().prepare('SELECT * FROM enterprise_projects WHERE draftId=? OR runtimeId=?').get(appId, appId);
}
export function canAccess(project, action='use') {
  const user = principal();
  if (!project || !user || project.scopeId !== user.scopeId) return false;
  if (isAdmin()) return true;
  if (project.ownerId === user.userId) return true;
  const row = getDb().prepare('SELECT role FROM enterprise_members WHERE projectId=? AND userId=?').get(project.id,user.userId);
  if (action === 'use') return Boolean(row);
  if (action === 'publish') return row?.role === 'publisher';
  return ['builder','publisher'].includes(row?.role);
}
export function appVisible(appId) {
  const current = workspaceContext();
  if (!current || current.mode==='system') return true;
  const project=projectFor(appId);
  if(current.mode==='runtime' && project?.runtimeId===appId) {
    current.releases ||= new Map();
    if(current.releases.has(appId) && current.releases.get(appId)!==project.releaseNumber) throw new AppError(409,'应用已发布新版本，请刷新或重新发起操作');
    current.releases.set(appId,project.releaseNumber);
  }
  return Boolean(project && (isBuilder()
    ? project.draftId===appId && canBuild() && canAccess(project,'build')
    : project.runtimeId===appId && project.releaseNumber>0 && project.status==='published' && Boolean(getDb().prepare('SELECT 1 FROM apps WHERE id=? AND enabled=1').get(appId)) && canAccess(project)));
}
export function registerDraft(appId) {
  if (!isBuilder()) return;
  const user = principal();
  getDb().prepare('INSERT INTO enterprise_projects(id,draftId,ownerId,scopeId) VALUES(?,?,?,?)').run(appId,appId,user.userId,user.scopeId);
}
export const BUSINESS_TOOLS = new Set(['query_data','add_record','update_record','delete_record']);
export function requireTool(name, input={}) {
  const current=workspaceContext();
  if (!current || current.mode==='system') return;
  if (isBuilder()) requireBuilder();
  else if (!BUSINESS_TOOLS.has(name)) throw new AppError(403,'业务助手无权使用构建工具');
  if (input.appId && !appVisible(input.appId)) throw new AppError(404,'找不到有权访问的应用');
  if (!isBuilder() && !input.appId) throw new AppError(403,'请先选择已发布的业务应用');
  if (['create_scheduled_task','test_scheduled_task'].includes(name)) throw new AppError(409,'预览环境暂不执行定时任务');
}
