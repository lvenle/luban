export function applicationBase() {
  return globalThis.document?.querySelector('base')?.getAttribute('href') || '/';
}
export function appUrl(path) {
  const base = applicationBase();
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.startsWith('/api/identity/') || base === '/' || path.startsWith(base)) return path;
  return base + path.slice(1);
}
export function applicationPath(path = globalThis.location?.pathname || '/') {
  const base = applicationBase();
  return base !== '/' && path.startsWith(base) ? '/' + path.slice(base.length) : path;
}
