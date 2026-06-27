import { h } from './dom.js';

let toastContainer = null;

function getContainer() {
  if (!toastContainer) {
    toastContainer = document.querySelector('.toast-container');
    if (!toastContainer) {
      toastContainer = h('div', { class: 'toast-container', 'aria-live': 'polite', 'aria-relevant': 'additions' });
      document.body.append(toastContainer);
    }
  }
  return toastContainer;
}

export function toast(message, type, action) {
  if (!type) {
    if (/^已|成功|完成|保存|更新|复制|创建|删除|导入|导出|生成|重命名/.test(message)) type = 'success';
    else if (/失败|错误|找不到|不能|已存在|无效|不支持|为空/.test(message)) type = 'error';
    else if (/警告|注意|建议|提示/.test(message)) type = 'warning';
  }
  const children = [h('span', { text: message })];
  if (action) {
    children.push(h('button', {
      class: 'toast-action',
      text: action.label,
      onclick: (e) => {
        e.stopPropagation();
        el.remove();
        action.callback();
      }
    }));
  }
  children.push(h('button', { class: 'toast-close', text: '✕', onclick: () => el.remove() }));
  const el = h('div', { class: `toast${type ? ` toast-${type}` : ''}` }, children);
  el.addEventListener('click', () => el.remove());
  getContainer().append(el);
  setTimeout(() => { if (el.parentNode) el.remove(); }, 4000);
}
