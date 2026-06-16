import h from './dom.js';

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
  }

  render() {
    const messages = h('div', { class: 'assistant-messages' });
    this.messagesEl = messages;

    const quick = h('div', { class: 'assistant-quick' }, [
      h('button', { class: 'assistant-chip', text: '创建任务管理', onclick: () => this.setInput('创建一个任务管理软件') }),
      h('button', { class: 'assistant-chip', text: '添加字段', onclick: () => this.setInput('帮我添加一个字段') }),
      h('button', { class: 'assistant-chip', text: '分析数据', onclick: () => this.setInput('分析一下当前数据') }),
      h('button', { class: 'assistant-chip', text: '生成报表', onclick: () => this.setInput('生成一个统计报表') })
    ]);
    this.quickChips = quick;

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
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
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
