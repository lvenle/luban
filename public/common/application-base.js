export function applicationBase() {
  return globalThis.document?.querySelector('base')?.getAttribute('href') || '/';
}
export function appUrl(path) {
  const enterprise=globalThis.document?.querySelector('meta[name="luban-enterprise"]');
  const builder=enterprise && /^\/builder(?:\/|$)/.test(applicationPath());
  if(builder && typeof path==='string' && path.startsWith('/uploads/'))path='/api/builder/files/'+path.slice('/uploads/'.length);
  if(builder && typeof path==='string' && path.startsWith('/api/') && !path.startsWith('/api/builder/') && !path.startsWith('/api/identity/') && !path.startsWith('/api/auth/') && path!=='/api/workspace') path='/api/builder/'+path.slice(5);
  const base = applicationBase();
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.startsWith('/api/identity/') || base === '/' || path.startsWith(base)) return path;
  return base + path.slice(1);
}
export function applicationPath(path = globalThis.location?.pathname || '/') {
  const base = applicationBase();
  return base !== '/' && path.startsWith(base) ? '/' + path.slice(base.length) : path;
}
