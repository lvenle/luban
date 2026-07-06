const LEGACY_TABLE_PAGE_TYPES = new Set(['table', 'list', 'grid', 'spreadsheet']);

export function entityDisplayName(app, entityOrId) {
  const entityId = typeof entityOrId === 'string' ? entityOrId : entityOrId?.id;
  const entity = typeof entityOrId === 'object'
    ? entityOrId
    : app?.schema?.entities?.find((item) => item.id === entityId);
  const pages = app?.ui?.pages || [];
  const tablePage = pages.find((page) => page.entity === entityId && (
    page.navKind === 'table' || page.source === 'table' || LEGACY_TABLE_PAGE_TYPES.has(page.type)
  ));
  const relatedPage = tablePage || pages.find((page) => page.entity === entityId);
  return String(relatedPage?.title || entity?.name || entityId || '');
}
