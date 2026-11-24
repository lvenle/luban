/** Compose product-provided runtime extensions into the shared Agent system prompt. */
export function composeSystemPrompt(system = '', extensions = []) {
  const parts = [String(system || '').trim()];
  for (const extension of extensions || []) {
    if (!extension || typeof extension !== 'object') continue;
    const content = String(extension.content ?? extension.prompt ?? '').trim();
    if (!content) continue;
    const id = String(extension.id ?? extension.name ?? 'extension').trim() || 'extension';
    parts.push(`\n[Agent Platform 扩展：${id}]\n${content}`);
  }
  return parts.filter(Boolean).join('\n');
}
