import { h } from './dom.js';

export function toast(message) {
  const el = h('div', { class: 'toast', text: message });
  document.body.append(el);
  setTimeout(() => el.remove(), 3200);
}
