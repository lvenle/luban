import { applicationPath, appUrl } from './application-base.js';
export const enterpriseUi = () => Boolean(globalThis.document?.querySelector('meta[name="luban-enterprise"]'));
export const builderUi = () => enterpriseUi() && /^\/builder(?:\/|$)/.test(applicationPath());
export const canDesign = () => !enterpriseUi() || builderUi();
export function switchWorkspace(builder) {
  const path=builder?'/builder/':'/';
  navigateWorkspace(path);
}

// Internal navigation keeps the host header, document and loaded assets in place.
export function navigateWorkspace(path, state = null) {
  const target = appUrl(path);
  if (location.pathname + location.search === target) return;
  history.pushState(state, '', target);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

const releases=new Map();
export function rememberRelease(app){if(app?.releaseNumber)releases.set(app.id,app.releaseNumber);}
export function releaseHeaders(path,method='GET'){const id=path.match(/^\/api\/apps\/([^/]+)/)?.[1];return enterpriseUi()&&!builderUi()&&method!=='GET'&&releases.has(id)?{'x-luban-release':String(releases.get(id))}:{};}

export function openSettingsPage(kind = 'assistant') {
  const target = appUrl(`${builderUi() ? '/builder' : ''}/settings/${kind === 'system' ? 'system' : 'assistant'}`);
  if (location.pathname === target) return;
  navigateWorkspace(target, { settingsReturnTo: history.state?.settingsReturnTo || location.pathname + location.search });
}
