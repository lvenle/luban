import h from './dom.js';

export default class StreamRenderer {
  constructor(container) {
    this.container = container;
    this.currentMessageEl = null;
    this.cursorEl = null;
    this.accumulatedText = '';
    this.thinkingEl = null;
  }

  startNewMessage() {
    this.currentMessageEl = h('div', { class: 'assistant-msg ai' }, [
      h('div', { class: 'assistant-avatar ai', text: 'AI' }),
      h('div', { class: 'assistant-bubble streaming' })
    ]);
    this.container.append(this.currentMessageEl);
    const bubble = this.currentMessageEl.querySelector('.assistant-bubble');
    const placeholder = document.createTextNode('思考中...');
    this.thinkingEl = placeholder;
    bubble.append(placeholder);
    this.cursorEl = h('span', { class: 'stream-cursor', text: '|' });
    bubble.append(this.cursorEl);
    this.accumulatedText = '';
    this.scrollToBottom();
  }

  appendToken(text) {
    if (!this.currentMessageEl) return;
    this.accumulatedText += text;
    const bubble = this.currentMessageEl.querySelector('.assistant-bubble');
    if (this.thinkingEl) {
      this.thinkingEl.remove();
      this.thinkingEl = null;
    }
    const parts = text.split('\n');
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        const br = document.createElement('br');
        if (this.cursorEl) bubble.insertBefore(br, this.cursorEl);
        else bubble.append(br);
      }
      if (this.cursorEl) {
        bubble.insertBefore(document.createTextNode(parts[i]), this.cursorEl);
      } else {
        bubble.append(document.createTextNode(parts[i]));
      }
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
    if (this.thinkingEl) {
      this.thinkingEl.remove();
      this.thinkingEl = null;
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
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/((?:\|.+\|\n?)+)/g, (match) => {
      const lines = match.trim().split('\n').filter((l) => l.startsWith('|'));
      if (lines.length < 2) return match;
      const isSep = (l) => /^\|[\s:-]+(\|[\s:-]+)*\|$/.test(l);
      const sepIdx = lines.findIndex(isSep);
      if (sepIdx < 0 || sepIdx > 1) return match;
      const headers = lines[0].split('|').filter(Boolean).map((c) => `<th>${c.trim()}</th>`).join('');
      let body = '';
      for (let i = sepIdx + 1; i < lines.length; i++) {
        const cells = lines[i].split('|').filter(Boolean).map((c) => `<td>${c.trim()}</td>`).join('');
        if (cells) body += `<tr>${cells}</tr>`;
      }
      return `<table><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table>`;
    });
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
