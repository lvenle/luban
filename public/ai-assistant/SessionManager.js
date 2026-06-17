import h from './dom.js';

export default class SessionManager {
  constructor(options = {}) {
    this.onSwitch = options.onSwitch || (() => {});
    this.onNew = options.onNew || (() => {});
    this.currentSessionId = null;
    this.sessions = [];
    this.selectEl = null;
    this.loading = false;
  }

  async load(appId) {
    try {
      const res = await fetch(`/api/ai/sessions?appId=${encodeURIComponent(appId || '')}`);
      const body = await res.json();
      this.sessions = body.sessions || [];
      this.renderSelect();
      if (this.sessions.length && !this.currentSessionId) {
        this.onSwitch(this.sessions[0].id);
      }
    } catch { /* ignore */ }
  }

  renderSelect() {
    if (!this.selectEl) return null;
    this.selectEl.innerHTML = '';
    if (this.sessions.length === 0) {
      this.selectEl.append(h('option', { value: '', text: '无历史会话' }));
      return;
    }
    for (const session of this.sessions) {
      const preview = session.preview ? session.preview.slice(0, 30) : session.status;
      const icons = { completed: '✅', failed: '❌', idle: '💬', clarifying: '❓', planning: '📋', executing: '⏳', cancelled: '⏭️' };
      const icon = icons[session.status] || '💬';
      const time = session.updatedAt ? new Date(session.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
      this.selectEl.append(h('option', { value: session.id, text: `[${time}] ${preview} ${icon}` }));
    }
  }

  render() {
    const select = h('select', {
      class: 'assistant-history-select',
      onchange: () => {
        const id = select.value;
        if (id) this.onSwitch(id);
      }
    });
    this.selectEl = select;

    const newBtn = h('button', {
      class: 'ghost',
      text: '新会话',
      onclick: () => this.onNew()
    });

    return h('div', { class: 'assistant-head-actions' }, [
      h('span', { class: 'history-label', text: '历史会话' }),
      select,
      newBtn
    ]);
  }

  setCurrent(id) {
    this.currentSessionId = id;
    if (this.selectEl) this.selectEl.value = id || '';
  }
}
