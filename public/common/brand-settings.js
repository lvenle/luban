import { globalStorageKey, readStorage, writeStorage } from './storage.js';

const BRAND_KEY = globalStorageKey('brand-settings');

export const DEFAULT_BRAND_SETTINGS = {
  systemName: '鲁班高级版',
  homeSlogan: '鲁班高级版 · AI 原生软件创作平台',
  homeTagline: '用自然语言创建、运行和持续改造属于你的业务软件。'
};

export function getBrandSettings() {
  const saved = readStorage(BRAND_KEY, {});
  if (['鲁班AI系统', '鲁班'].includes(saved.systemName)) saved.systemName = DEFAULT_BRAND_SETTINGS.systemName;
  return { ...DEFAULT_BRAND_SETTINGS, ...saved };
}

export function updateBrandSettings(patch = {}) {
  const next = { ...getBrandSettings(), ...patch };
  writeStorage(BRAND_KEY, next);
  document.title = next.systemName || DEFAULT_BRAND_SETTINGS.systemName;
  return next;
}

export function editableBrandText(h, { value, className = '', title = '双击编辑', onSave }) {
  const display = h('span', {
    class: `brand-edit-text ${className}`,
    text: value || '',
    title,
    ondblclick: (event) => {
      event.preventDefault();
      event.stopPropagation();
      const input = h('input', { class: 'brand-edit-input', type: 'text', value: display.textContent });
      display.replaceWith(input);
      input.focus();
      input.select();
      let done = false;
      const finish = async (save) => {
        if (done) return;
        done = true;
        const next = input.value.trim();
        if (save && next && next !== value) await onSave(next);
        else input.replaceWith(display);
      };
      input.addEventListener('click', (inputEvent) => inputEvent.stopPropagation());
      input.addEventListener('blur', () => finish(true));
      input.addEventListener('keydown', (keyEvent) => {
        if (keyEvent.key === 'Enter') input.blur();
        if (keyEvent.key === 'Escape') finish(false);
      });
    }
  });
  return display;
}
