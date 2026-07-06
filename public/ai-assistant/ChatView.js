import h from './dom.js';

const CREATE_PRESETS = [
  ['创建任务管理', '创建一个任务管理软件'],
  ['创建项目管理', '创建一个项目管理软件'],
  ['创建客户管理', '创建一个客户管理软件'],
  ['创建收支记录', '创建一个收支记录软件']
];

const MODIFY_PRESETS = [
  ['新增字段', '帮我新增一个字段'],
  ['新增页面', '帮我新增一个页面'],
  ['新增数据分析', '帮我新增一个数据分析页面'],
  ['添加10行样例数据', '为当前数据表添加10行样例数据']
];

export default class ChatView {
  constructor(options = {}) {
    this.onSend = options.onSend || (() => {});
    this.onNewSession = options.onNewSession || (() => {});
    this.messagesEl = null;
    this.inputEl = null;
    this.sendBtn = null;
    this.quickChips = null;
    this.element = null;
    this.streaming = false;
    this.mode = options.mode === 'modify' ? 'modify' : 'create';
  }

  render() {
    const messages = h('div', { class: 'assistant-messages' });
    this.messagesEl = messages;

    const quick = h('div', { class: 'assistant-quick' });
    this.quickChips = quick;
    this.renderQuickChips();

    const input = h('textarea', {
      class: 'assistant-input-field',
      placeholder: '输入你的需求...',
      value: '',
      oninput: (e) => { if (this.onInput) this.onInput(e.target.value); },
      onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); } }
    });
    this.inputEl = input;

    const sendBtn = h('button', {
      class: 'assistant-send',
      text: '↵',
      disabled: this.streaming ? 'disabled' : null,
      onclick: () => this.send()
    });
    this.sendBtn = sendBtn;

    const inputRow = h('div', { class: 'assistant-input-row' }, [input, sendBtn]);

    this.element = h('div', { class: 'assistant-chat' }, [
      messages,
      quick,
      h('div', { class: 'assistant-input' }, [inputRow])
    ]);

    return this.element;
  }

  setInput(text) {
    this.inputEl.value = text;
    this.inputEl.focus();
  }

  setMode(mode) {
    this.mode = mode === 'modify' ? 'modify' : 'create';
    this.renderQuickChips();
  }

  renderQuickChips() {
    if (!this.quickChips) return;
    const presets = this.mode === 'create' ? CREATE_PRESETS : MODIFY_PRESETS;
    this.quickChips.replaceChildren(...presets.map(([label, prompt]) =>
      h('button', { class: 'assistant-chip', text: label, onclick: () => this.setInput(prompt) })
    ));
    this.quickChips.hidden = presets.length === 0;
  }

  send() {
    const text = this.inputEl.value.trim();
    if (!text || this.streaming) return;
    this.inputEl.value = '';
    this.onSend(text);
  }

  addMessage(type, content, extra) {
    if (type === 'user') {
      this.messagesEl.append(h('div', { class: 'assistant-msg user' }, [
        h('div', { class: 'assistant-bubble', text: content }),
        h('div', { class: 'assistant-avatar user', text: '你' })
      ]));
    } else if (type === 'ai' || type === 'stream') {
      // handled by StreamRenderer
    }
    this.scrollToBottom();
  }

  addElement(el) {
    this.messagesEl.append(el);
    this.scrollToBottom();
  }

  setStreaming(streaming) {
    this.streaming = streaming;
    if (this.sendBtn) {
      if (streaming) this.sendBtn.setAttribute('disabled', 'disabled');
      else this.sendBtn.removeAttribute('disabled');
    }
  }

  scrollToBottom() {
    setTimeout(() => {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }, 0);
  }

  clear() {
    this.messagesEl.innerHTML = '';
  }

  getMessageContainer() {
    return this.messagesEl;
  }

  startNewSession() {
    this.clear();
    this.addMessage('system', '新会话已开始');
    this.streaming = false;
    if (this.sendBtn) this.sendBtn.removeAttribute('disabled');
  }
}
