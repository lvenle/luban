export function appCategory(app) {
  const explicitCategory = String(app?.manifest?.category || app?.category || '').trim();
  if (explicitCategory) return explicitCategory;

  const text = `${app?.name || ''} ${(app?.manifest?.tags || []).join(' ')} ${app?.description || app?.manifest?.description || ''}`.toLowerCase();
  if (text.includes('crm') || text.includes('客户') || text.includes('线索')) return '客户';
  if (text.includes('finance') || text.includes('记账') || text.includes('预算') || text.includes('金额')) return '财务';
  if (text.includes('writing') || text.includes('文章') || text.includes('内容') || text.includes('脚本')) return '内容';
  if (text.includes('productivity') || text.includes('待办') || text.includes('任务') || text.includes('项目')) return '效率';
  if (text.includes('库存') || text.includes('资产') || text.includes('设备')) return '资产';
  return '通用';
}
