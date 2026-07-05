import { h } from '../common/dom.js';

export function createMarkdownCodeEditor(textarea) {
  textarea.setAttribute('wrap', 'off');
  const numbers = h('div', { class: 'markdown-line-numbers', 'aria-hidden': 'true' });
  const refresh = () => {
    const count = Math.max(1, textarea.value.split('\n').length);
    numbers.textContent = Array.from({ length: count }, (_, index) => index + 1).join('\n');
  };
  textarea.addEventListener('input', refresh);
  textarea.addEventListener('scroll', () => { numbers.scrollTop = textarea.scrollTop; });
  refresh();
  return {
    element: h('div', { class: 'markdown-code-editor' }, [numbers, textarea]),
    refresh
  };
}
