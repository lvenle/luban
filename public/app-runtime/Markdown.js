export function renderMarkdown(text) {
  let html = stripLegacyMarkdownStyles(text);
  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  html = html.replace(/```(?:\w*)\n([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^&gt;\s?(.+)$/gm, '<blockquote>$1</blockquote>');
  html = html.replace(/^---$/gm, '<hr>');
  html = html.replace(/^- \[([ xX])\] (.+)$/gm, (_, checked, label) => `<div class="markdown-task"><input type="checkbox" disabled ${checked.trim() ? 'checked' : ''}> ${label}</div>`);
  html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (items) => `<ul>${items.replace(/\n/g, '')}</ul>`);
  html = html.replace(/^\d+\. (.+)$/gm, '<oli>$1</oli>');
  html = html.replace(/(<oli>.*<\/oli>\n?)+/g, (items) => `<ol>${items.replaceAll('<oli>', '<li>').replaceAll('</oli>', '</li>').replace(/\n/g, '')}</ol>`);
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  // 保护 <pre><code> 块内的换行不被后续 <br> 替换破坏
  const preBlocks = [];
  html = html.replace(/<pre><code>[\s\S]*?<\/code><\/pre>/g, (match) => {
    preBlocks.push(match);
    return `\x00PREBLOCK${preBlocks.length - 1}\x00`;
  });
  html = html.replace(/\n/g, '<br>');
  html = html.replace(/\x00PREBLOCK(\d+)\x00/g, (_, i) => preBlocks[Number(i)]);
  return html;
}

export function stripLegacyMarkdownStyles(text) {
  return String(text || '').replace(/<span\s+style="(?:font-family|font-size):\s*[^";]+;?">([\s\S]*?)<\/span>/gi, '$1');
}
