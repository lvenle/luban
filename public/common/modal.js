import { h } from './dom.js';

export function openConfirmDialog({ title = '确认操作', message = '', confirmText = '确认', danger = false, onConfirm }) {
  const backdrop = h('div', { class: 'modal-backdrop' }, [
    h('div', { class: 'modal confirm-modal' }, [
      h('div', { class: 'toolbar' }, [
        h('h3', { text: title }),
        h('button', { class: 'ghost', text: '关闭', onclick: () => backdrop.remove() })
      ]),
      h('p', { class: 'muted', text: message }),
      h('div', { class: 'row', style: 'margin-top:14px; justify-content:flex-end' }, [
        h('button', { class: 'secondary', text: '取消', onclick: () => backdrop.remove() }),
        h('button', {
          class: danger ? 'danger' : '',
          text: confirmText,
          onclick: async () => {
            backdrop.remove();
            await onConfirm?.();
          }
        })
      ])
    ])
  ]);
  document.body.append(backdrop);
}

export function openConfigModal(title, content, actions) {
  const backdrop = h('div', { class: 'modal-backdrop' }, [
    h('div', { class: 'modal' }, [
      h('div', { class: 'toolbar' }, [h('h3', { text: title }), h('button', { class: 'ghost', text: '关闭', onclick: () => backdrop.remove() })]),
      content,
      h('div', { class: 'row', style: 'margin-top:14px' }, actions)
    ])
  ]);
  document.body.append(backdrop);
}

export function closeTopModal() {
  document.querySelector('.modal-backdrop')?.remove();
}

export function openTextModal(title, text) {
  const backdrop = h('div', { class: 'modal-backdrop' }, [
    h('div', { class: 'modal' }, [
      h('div', { class: 'toolbar' }, [h('h3', { text: title }), h('button', { class: 'ghost', text: '关闭', onclick: () => backdrop.remove() })]),
      h('textarea', { style: 'min-height:300px', readonly: 'readonly' }, text)
    ])
  ]);
  document.body.append(backdrop);
}

export function floatingMenus() {
  return [...document.querySelectorAll('details.card-menu, details.view-menu, details.export-menu, details.page-menu')];
}

export function closeFloatingMenus(except = null) {
  floatingMenus().forEach((menu) => {
    if (menu !== except) menu.open = false;
  });
}

export function bindFloatingMenu(details) {
  details.addEventListener('toggle', () => {
    if (details.open) closeFloatingMenus(details);
  });
  details.addEventListener('focusout', () => {
    requestAnimationFrame(() => {
      if (details.open && !details.contains(document.activeElement)) details.open = false;
    });
  });
  return details;
}
