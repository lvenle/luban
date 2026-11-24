import { AsyncLocalStorage } from 'node:async_hooks';
const context = new AsyncLocalStorage();
/** Trusted host API. Identity must come from a verified session, never request headers. */
export function withApplicationIdentity(identity, applicationId, callback) {
  if (!identity?.userId || !identity.scopeId || !applicationId) throw Error('Verified application identity is required');
  const verified = Object.freeze({ ...identity, grants: Object.freeze([...(identity.grants || [])]) });
  return context.run(Object.freeze({ identity: verified, applicationId }), callback);
}
export function applicationRequestContext() { return context.getStore() || null; }
export function applicationRunOwner() {
  const identity = context.getStore()?.identity;
  return identity ? `${identity.scopeId}:${identity.userId}` : 'local';
}
export function requireApplicationManager() {
  const current = context.getStore();
  if (!current || current.identity.role === 'admin' || current.identity.grants.includes(`${current.applicationId}:manage`)) return;
  const error = new Error('当前用户无权管理此应用'); error.status = 403; throw error;
}
