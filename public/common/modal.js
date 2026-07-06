import { h } from './dom.js';

let modalAccessibilityReady = false;
let modalSequence = 0;
const modalFocus = new WeakMap();
let lastFocusOutsideModal = null;

export function setupModalAccessibility() {
  if (modalAccessibilityReady) return;
  modalAccessibilityReady = true;
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.classList.contains('modal-backdrop')) decorateModal(node);
        node.querySelectorAll?.('.modal-backdrop').forEach(decorateModal);
      }
      for (const node of mutation.removedNodes) {
        if (node instanceof HTMLElement && node.classList.contains('modal-backdrop')) restoreModalFocus(node);
      }
    }
    updateBackgroundInert();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('keydown', handleModalKeydown, true);
  document.addEventListener('focusin', (event) => {
    if (!event.target.closest?.('.modal-backdrop')) lastFocusOutsideModal = event.target;
  }, true);
  document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest?.('.modal-backdrop')) lastFocusOutsideModal = event.target.closest?.('button,a,input,select,textarea,[tabindex]') || event.target;
  }, true);
}

function decorateModal(backdrop) {
  if (backdrop.dataset.accessibleModal === 'true') return;
  backdrop.dataset.accessibleModal = 'true';
  const active = document.activeElement;
  modalFocus.set(backdrop, focusDescriptor(active && active !== document.body ? active : lastFocusOutsideModal));
  const modal = backdrop.querySelector('.modal');
  if (!modal) return;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('tabindex', '-1');
  const title = modal.querySelector('h1,h2,h3,h4');
  if (title) {
    title.id ||= `modal-title-${++modalSequence}`;
    modal.setAttribute('aria-labelledby', title.id);
  }
  backdrop.addEventListener('pointerdown', (event) => {
    if (event.target === backdrop) backdrop.remove();
  });
  queueMicrotask(() => {
    if (!backdrop.isConnected || backdrop.contains(document.activeElement)) return;
    (modal.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex="0"]') || modal).focus();
  });
}

function handleModalKeydown(event) {
  const backdrops = [...document.querySelectorAll('.modal-backdrop[data-accessible-modal="true"]')];
  const backdrop = backdrops.at(-1);
  if (!backdrop) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    backdrop.remove();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = [...backdrop.querySelectorAll('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex="0"]')]
    .filter((item) => item.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function restoreModalFocus(backdrop) {
  const previous = modalFocus.get(backdrop);
  queueMicrotask(() => {
    if (previous?.element?.isConnected) return previous.element.focus?.();
    const candidates = [...document.querySelectorAll(previous?.tag || 'button')];
    const replacement = candidates.find((item) => item.textContent?.trim() === previous?.text && (!previous?.title || item.title === previous.title));
    replacement?.focus?.();
  });
}

function focusDescriptor(element) {
  if (!(element instanceof HTMLElement)) return null;
  return { element, tag: element.tagName.toLowerCase(), text: element.textContent?.trim() || '', title: element.title || '' };
}

function updateBackgroundInert() {
  const active = [...document.body.children].filter((item) => item.classList?.contains('modal-backdrop'));
  for (const child of document.body.children) {
    if (child.classList?.contains('modal-backdrop')) continue;
    child.inert = active.length > 0;
  }
}

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

export function bindDismissiblePopover(popover, trigger = null) {
  const controller = new AbortController();
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    controller.abort();
    popover.remove();
  };
  document.addEventListener('pointerdown', (event) => {
    if (!popover.contains(event.target) && (!trigger || !trigger.contains(event.target))) close();
  }, { capture: true, signal: controller.signal });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  }, { signal: controller.signal });
  window.addEventListener('resize', close, { signal: controller.signal });
  window.addEventListener('scroll', close, { capture: true, signal: controller.signal });
  return close;
}
