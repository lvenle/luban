import { toast } from './toast.js';

export function startInlineRename(target, {
  value = target?.textContent || '',
  className = '',
  emptyMessage = '名称不能为空。',
  validate = null,
  onSave,
  onCancel = null
} = {}) {
  if (!target?.isConnected || typeof onSave !== 'function') return null;

  const originalValue = String(value || '');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = `inline-rename-input ${className}`.trim();
  input.value = originalValue;
  input.setAttribute('aria-label', '重命名');
  target.replaceWith(input);

  let finished = false;
  let saving = false;
  const restore = (nextValue = originalValue) => {
    target.textContent = nextValue;
    if (input.isConnected) input.replaceWith(target);
  };
  const focusInput = () => requestAnimationFrame(() => {
    if (!input.isConnected) return;
    input.focus();
    input.select();
  });
  const finish = async (save) => {
    if (finished || saving) return;
    if (!save) {
      finished = true;
      restore();
      onCancel?.();
      return;
    }
    const nextValue = input.value.trim();
    if (!nextValue) {
      toast(emptyMessage);
      focusInput();
      return;
    }
    const validationMessage = await validate?.(nextValue);
    if (validationMessage) {
      toast(validationMessage);
      focusInput();
      return;
    }
    if (nextValue === originalValue) {
      finished = true;
      restore();
      onCancel?.();
      return;
    }
    saving = true;
    input.disabled = true;
    try {
      await onSave(nextValue);
      finished = true;
      restore(nextValue);
    } catch (error) {
      saving = false;
      input.disabled = false;
      toast(error?.message || '重命名失败，请重试。');
      focusInput();
    }
  };

  input.addEventListener('pointerdown', (event) => event.stopPropagation());
  input.addEventListener('click', (event) => event.stopPropagation());
  input.addEventListener('dblclick', (event) => event.stopPropagation());
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    }
  });
  focusInput();
  return input;
}
