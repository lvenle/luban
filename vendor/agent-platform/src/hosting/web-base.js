import {workbenchNavigationMeta} from './workbench-navigation.js';
/** Trusted deployment paths only; no request header may choose the application base. */
export function normalizeWebBase(value = '/') {
  if (typeof value !== 'string' || !/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(value)) throw new TypeError('Application base must be a safe absolute directory path');
  return value;
}
export function normalizeApplicationLinks(links = []) {
  if(!Array.isArray(links))throw new TypeError('Application links must be an array');
  return links.map(link=>{
    if(typeof link?.name!=='string' || !link.name.trim() || link.name.length>80 || typeof link.href!=='string' || !/^\/(?!\/)[a-zA-Z0-9/_-]+$/.test(link.href))throw new TypeError('Invalid application navigation link');
    if(link.replaces!==undefined && (!Array.isArray(link.replaces) || link.replaces.some(id=>typeof id!=='string' || !/^[a-z][a-z0-9-]*$/.test(id))))throw new TypeError('Invalid replaced application id');
    return {name:link.name.trim(),href:link.href,...(link.replaces?.length?{replaces:[...link.replaces]}:{})};
  });
}
export function documentWithBase(html, value = '/', applicationLinks = [], workbenchNavigation = null) {
  const base = normalizeWebBase(value);
  const links=normalizeApplicationLinks(applicationLinks);
  const encoded=JSON.stringify(links).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const navigation=links.length?`<meta name="platform-applications" content="${encoded}">`:'';
  return String(html).replace(/<head(?:\s[^>]*)?>/i, match => match + `<base href="${base}">` + navigation + (workbenchNavigation?workbenchNavigationMeta(workbenchNavigation):''));
}
