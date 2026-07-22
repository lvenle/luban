import { h } from '../common/dom.js';
import { api } from '../common/api.js';
import { toast } from '../common/toast.js';

export function renderLogin(root, onSuccess) {
  const username = h('input', { autocomplete: 'username', placeholder: '用户名' });
  const password = h('input', { type: 'password', autocomplete: 'current-password', placeholder: '密码' });
  const error = h('p', { class: 'login-error', text: '' });
  const form = h('form', { class: 'login-card', onsubmit: async (event) => {
    event.preventDefault();
    error.textContent = '';
    try {
      await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: username.value, password: password.value })
      });
      toast('登录成功');
      await onSuccess();
    } catch (err) {
      error.textContent = err.message || '登录失败';
      password.focus();
      password.select();
    }
  } }, [
    h('h1', { text: '登录鲁班 AI' }),
    h('p', { class: 'muted', text: '请输入系统设置中配置的用户名和密码。' }),
    h('div', { class: 'field' }, [h('label', { text: '用户名' }), username]),
    h('div', { class: 'field' }, [h('label', { text: '密码' }), password]),
    error,
    h('button', { text: '登录' })
  ]);
  root.replaceChildren(h('main', { class: 'login-shell' }, [form]));
  username.focus();
}
