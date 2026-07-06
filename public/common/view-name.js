export function normalizeViewName(value) {
  return String(value || '').trim().normalize('NFKC').toLocaleLowerCase();
}

export function viewNameExists(views, name, excludedViewId = '') {
  const normalized = normalizeViewName(name);
  if (!normalized) return false;
  return (views || []).some((view) => view.id !== excludedViewId && normalizeViewName(view.name) === normalized);
}

export function uniqueViewName(views, preferredName) {
  const base = String(preferredName || '').trim() || '新视图';
  if (!viewNameExists(views, base)) return base;
  let index = 2;
  while (viewNameExists(views, `${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}
