import h from './dom.js';

export default class StreamRenderer {
  constructor(container) {
    this.container = container;
    this.currentMessageEl = null;
    this.cursorEl = null;
    this.accumulatedText = '';
  }

  startNewMessage() {
    this.currentMessageEl = h('div', { class: 'assistant-msg ai' }, [
      h('div', { class: 'assistant-avatar ai', text: 'AI' }),
      h('div', { class: 'assistant-bubble streaming' })
    ]);
    this.container.append(this.currentMessageEl);
    this.cursorEl = h('span', { class: 'stream-cursor', text: '|' });
    this.currentMessageEl.querySelector('.assistant-bubble').append(this.cursorEl);
    this.accumulatedText = '';
    this.scrollToBottom();
  }

  appendToken(text) {
    if (!this.currentMessageEl) return;
    this.accumulatedText += text;
    const bubble = this.currentMessageEl.querySelector('.assistant-bubble');
    if (this.cursorEl) {
      bubble.insertBefore(document.createTextNode(text), this.cursorEl);
    } else {
      bubble.append(document.createTextNode(text));
    }
    this.scrollToBottom();
  }

  finishMessage(html) {
    if (!this.currentMessageEl) return;
    const bubble = this.currentMessageEl.querySelector('.assistant-bubble');
    bubble.classList.remove('streaming');
    if (this.cursorEl) {
      this.cursorEl.remove();
      this.cursorEl = null;
    }
    const content = html || this.accumulatedText;
    if (content) bubble.innerHTML = this.renderMarkdown(content);
    this.currentMessageEl = null;
    this.accumulatedText = '';
    this.scrollToBottom();
  }

  renderMarkdown(text) {
    let html = String(text || '');
    html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    html = html.replace(/\n\s*[-*]\s/g, '\n• ');
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  scrollToBottom() {
    const parent = this.container;
    setTimeout(() => {
      parent.scrollTop = parent.scrollHeight;
    }, 0);
  }

  reset() {
    this.currentMessageEl = null;
    this.cursorEl = null;
  }
}
