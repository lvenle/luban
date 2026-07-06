export function normalizePageTitle(value) {
  return String(value || '').trim().normalize('NFKC').toLocaleLowerCase();
}

export function pageTitleExists(pages, title, excludedPageId = '') {
  const normalized = normalizePageTitle(title);
  if (!normalized) return false;
  return (pages || []).some((page) => page.id !== excludedPageId && normalizePageTitle(page.title) === normalized);
}

export function uniquePageTitle(pages, preferredTitle) {
  const base = String(preferredTitle || '').trim() || '未命名页面';
  if (!pageTitleExists(pages, base)) return base;
  let index = 2;
  while (pageTitleExists(pages, `${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}
