import { h } from './dom.js';

export function toast(message, type) {
  // Auto-detect type from message content when not explicitly set
  if (!type) {
    if (/^已|成功|完成|保存|更新|复制|创建|删除|导入|导出|生成|重命名/.test(message)) type = 'success';
    else if (/失败|错误|找不到|不能|已存在|无效|不支持|为空/.test(message)) type = 'error';
    else if (/警告|注意|建议|提示/.test(message)) type = 'warning';
  }
  const el = h('div', { class: `toast${type ? ` toast-${type}` : ''}`, text: message });
  document.body.append(el);
  setTimeout(() => el.remove(), 3200);
}
