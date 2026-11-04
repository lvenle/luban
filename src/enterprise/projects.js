import { randomUUID, createHash } from 'node:crypto';
import { getDb, withTransaction, triggerBackup, getPackageFromApp } from '../storage/db.js';
import { createAppFromPackage, getApp, updateAppPackage, listApps } from '../models/app.js';
import { createRule, listRules, getRule, updateRuleDefinition, updateRuleStatus, deleteRule } from '../models/rule.js';
import { AppError } from '../core/errors.js';
import { withWorkspace, projectFor, principal, canAccess, requireBuilder, isAdmin } from './context.js';
const system = callback => withWorkspace({mode:'system'},callback);

export function initializeProjects() {
  const database=getDb();
  if(!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='enterprise_projects'").get() && database.prepare('SELECT 1 FROM apps LIMIT 1').get()) {
    const file=database.prepare('PRAGMA database_list').get().file;
    if(file)database.prepare('VACUUM INTO ?').run(file+'.before-enterprise-'+Date.now()+'.bak');
  }
  getDb().exec(`CREATE TABLE IF NOT EXISTS enterprise_projects(
    id TEXT PRIMARY KEY,draftId TEXT NOT NULL UNIQUE REFERENCES apps(id) ON DELETE CASCADE,
    runtimeId TEXT UNIQUE REFERENCES apps(id) ON DELETE SET NULL,ownerId TEXT,scopeId TEXT NOT NULL DEFAULT 'enterprise',
    status TEXT NOT NULL DEFAULT 'draft',releaseNumber INTEGER NOT NULL DEFAULT 0,publishedRevision TEXT);
    CREATE TABLE IF NOT EXISTS enterprise_releases(
      id TEXT PRIMARY KEY,projectId TEXT NOT NULL REFERENCES enterprise_projects(id) ON DELETE CASCADE,
      number INTEGER NOT NULL,revision TEXT NOT NULL,definition TEXT NOT NULL,createdBy TEXT NOT NULL,createdAt TEXT NOT NULL,
      UNIQUE(projectId,number));
    CREATE TABLE IF NOT EXISTS enterprise_rule_bindings(projectId TEXT NOT NULL REFERENCES enterprise_projects(id) ON DELETE CASCADE,draftRuleId TEXT NOT NULL,runtimeRuleId TEXT NOT NULL,PRIMARY KEY(projectId,draftRuleId));
    CREATE TABLE IF NOT EXISTS enterprise_members(
      projectId TEXT NOT NULL REFERENCES enterprise_projects(id) ON DELETE CASCADE,userId TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user','builder','publisher')),PRIMARY KEY(projectId,userId));`);
  // Existing local apps remain private until an administrator explicitly publishes them.
  system(()=>withTransaction(()=>{
    for (const app of listApps()) {
      if (projectFor(app.id)) continue;
      const draft=createAppFromPackage(getPackageFromApp(app));
      getDb().prepare('INSERT INTO enterprise_projects(id,draftId,runtimeId) VALUES(?,?,?)').run(app.id,draft.id,app.id);
      for(const rule of listRules(app.id)) {const copied=createRule({...rule,appId:draft.id});getDb().prepare('INSERT INTO enterprise_rule_bindings VALUES(?,?,?)').run(app.id,copied.id,rule.id);}
    }
  }));
  // Draft enablement controls foreground availability for the paired published app.
  // Align existing pairs created before this rule on startup.
  system(()=>{
    const result=getDb().prepare(`UPDATE apps AS runtime
      SET enabled=(SELECT draft.enabled FROM enterprise_projects project JOIN apps draft ON draft.id=project.draftId WHERE project.runtimeId=runtime.id),
          updatedAt=(SELECT draft.updatedAt FROM enterprise_projects project JOIN apps draft ON draft.id=project.draftId WHERE project.runtimeId=runtime.id)
      WHERE runtime.id IN (SELECT runtimeId FROM enterprise_projects WHERE runtimeId IS NOT NULL)
        AND enabled != (SELECT draft.enabled FROM enterprise_projects project JOIN apps draft ON draft.id=project.draftId WHERE project.runtimeId=runtime.id)`).run();
    if(result.changes)triggerBackup();
  });
}
export function describeProject(appId) {
  const p=projectFor(appId);
  if (!p || !canAccess(p,'build')) throw new AppError(404,'找不到应用');
  const draft=system(()=>getApp(p.draftId));
  const rules=system(()=>listRules(p.draftId));
  const revision=createHash('sha256').update(JSON.stringify([draft.updatedAt,rules])).digest('hex');
  return {...p,name:draft.name,revision,hasChanges:revision!==p.publishedRevision,
    canPublish:canAccess(p,'publish'),canManageMembers:isAdmin()||p.ownerId===principal()?.userId,releases:getDb().prepare('SELECT number,revision,createdBy,createdAt FROM enterprise_releases WHERE projectId=? ORDER BY number DESC').all(p.id),
    members:getDb().prepare('SELECT userId,role FROM enterprise_members WHERE projectId=?').all(p.id)};
}
function compatible(previous,next) {
  // Initial release supports unchanged schemas. Data migrations arrive in a subsequent phase.
  if (JSON.stringify(previous.schema)!==JSON.stringify(next.schema)) throw new AppError(409,'线上应用的数据结构已变化，首版暂不支持结构迁移；请保留原结构或创建新应用');
}
export function publishProject(appId,input) {
  requireBuilder();
  return withTransaction(()=>{
    const p=describeProject(appId);
    if (!p.canPublish) throw new AppError(403,'没有发布此应用的权限');
    if (input.revision!==p.revision || input.releaseNumber!==p.releaseNumber) throw new AppError(409,'草稿或线上版本已变化，请刷新后重新发布');
    const user=principal();
    return system(()=>{
      const draft=getApp(p.draftId),definition=getPackageFromApp(draft),rules=listRules(p.draftId);
      if (JSON.stringify(definition).includes('/uploads/')) throw new AppError(409,'草稿包含预览附件，请移除附件引用后发布');
      let runtime=p.runtimeId?getApp(p.runtimeId):null;
      if(runtime) { compatible(runtime,draft); runtime=updateAppPackage(runtime.id,definition); }
      else runtime=createAppFromPackage(definition);
      const bindings=getDb().prepare('SELECT * FROM enterprise_rule_bindings WHERE projectId=?').all(p.id);
      for(const rule of rules) {
        const binding=bindings.find(item=>item.draftRuleId===rule.id);
        if(binding && getRule(runtime.id,binding.runtimeRuleId)) {
          updateRuleDefinition(runtime.id,binding.runtimeRuleId,rule);
          updateRuleStatus(runtime.id,binding.runtimeRuleId,rule.status);
        } else {
          const created=createRule({...rule,appId:runtime.id});
          getDb().prepare('INSERT OR REPLACE INTO enterprise_rule_bindings VALUES(?,?,?)').run(p.id,rule.id,created.id);
        }
      }
      for(const binding of bindings)if(!rules.some(rule=>rule.id===binding.draftRuleId)) {deleteRule(runtime.id,binding.runtimeRuleId);getDb().prepare('DELETE FROM enterprise_rule_bindings WHERE projectId=? AND draftRuleId=?').run(p.id,binding.draftRuleId);}
      const number=p.releaseNumber+1;
      getDb().prepare('INSERT INTO enterprise_releases VALUES(?,?,?,?,?,?,?)').run(randomUUID(),p.id,number,p.revision,JSON.stringify({definition,rules}),user.userId,new Date().toISOString());
      getDb().prepare("UPDATE enterprise_projects SET runtimeId=?,status='published',releaseNumber=?,publishedRevision=? WHERE id=?").run(runtime.id,number,p.revision,p.id);
      triggerBackup();
      return {runtimeId:runtime.id,number};
    });
  });
}
export function updateMembers(appId,members) {
  requireBuilder();
  const p=describeProject(appId);
  if (!p.canManageMembers) throw new AppError(403,'没有成员管理权限');
  if (!Array.isArray(members) || members.length>500 || members.some(m=>!m || !/^[\w-]{1,100}$/.test(m.userId)||!['user','builder','publisher'].includes(m.role)) || new Set(members.map(m=>m.userId)).size!==members.length) throw new AppError(400,'成员授权格式无效');
  withTransaction(()=>{getDb().prepare('DELETE FROM enterprise_members WHERE projectId=?').run(p.id);for(const m of members)getDb().prepare('INSERT INTO enterprise_members VALUES(?,?,?)').run(p.id,m.userId,m.role);});
  triggerBackup();
}
