import { h } from '../../common/dom.js';
import { api } from '../../common/api.js';
import { toast } from '../../common/toast.js';

export function renderAuthPanel(auth = {}, onSaved = () => {}) {
  const username = h('input', { value: auth.username || '', autocomplete: 'username', placeholder: '用于登录系统的用户名' });
  const password = h('input', { type: 'password', autocomplete: 'new-password', placeholder: auth.enabled ? '输入新密码' : '设置登录密码' });
  const confirm = h('input', { type: 'password', autocomplete: 'new-password', placeholder: '再次输入密码' });
  const hint = auth.enabled ? `已启用登录验证：${auth.username || ''}` : '未设置账号密码时，系统不会要求登录。';
  return h('div', { class: 'auth-settings-panel' }, [
    h('p', { class: 'muted', text: hint }),
    h('div', { class: 'form-grid' }, [
      h('div', { class: 'field' }, [h('label', { text: '用户名' }), username]),
      h('div', { class: 'field' }, [h('label', { text: '密码' }), password]),
      h('div', { class: 'field' }, [h('label', { text: '确认密码' }), confirm])
    ]),
    h('p', { class: 'field-hint', text: '密码会以加盐哈希密文保存，系统不会存储或返回明文密码。' }),
    h('div', { class: 'row settings-actions' }, [
      h('button', { text: auth.enabled ? '更新账号密码' : '启用登录验证', onclick: async () => {
        if (password.value !== confirm.value) {
          toast('两次输入的密码不一致');
          confirm.focus();
          return;
        }
        const body = await api('/api/settings', {
          method: 'PUT',
          body: JSON.stringify({ auth: { username: username.value, password: password.value } })
        });
        onSaved(body.auth || {});
        password.value = '';
        confirm.value = '';
        toast('账号安全设置已保存');
        document.dispatchEvent(new CustomEvent('auth-login-required'));
      } }),
      auth.enabled ? h('button', { class: 'secondary', text: '退出登录', onclick: async () => {
        await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) });
        location.reload();
      } }) : null
    ])
  ]);
}
