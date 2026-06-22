export function wrapMarkdownSelection(value, start, end, prefix, suffix = prefix, placeholder = '文本') {
  const source = String(value || '');
  const selected = source.slice(start, end) || placeholder;
  const nextValue = `${source.slice(0, start)}${prefix}${selected}${suffix}${source.slice(end)}`;
  return {
    value: nextValue,
    selectionStart: start + prefix.length,
    selectionEnd: start + prefix.length + selected.length
  };
}

export function applyMarkdownHeading(value, start, end, level = 0) {
  const source = String(value || '');
  const lineStart = source.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const nextBreak = source.indexOf('\n', end);
  const lineEnd = nextBreak < 0 ? source.length : nextBreak;
  const line = source.slice(lineStart, lineEnd).replace(/^#{1,6}\s+/, '');
  const prefix = level > 0 ? `${'#'.repeat(Math.min(6, level))} ` : '';
  const replacement = `${prefix}${line}`;
  return {
    value: `${source.slice(0, lineStart)}${replacement}${source.slice(lineEnd)}`,
    selectionStart: lineStart + prefix.length,
    selectionEnd: lineStart + replacement.length
  };
}

export function applyMarkdownLinePrefix(value, start, end, prefix) {
  const source = String(value || '');
  const lineStart = source.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const nextBreak = source.indexOf('\n', end);
  const lineEnd = nextBreak < 0 ? source.length : nextBreak;
  const selected = source.slice(lineStart, lineEnd);
  const replacement = selected.split('\n').map((line) => `${prefix}${line}`).join('\n');
  return {
    value: `${source.slice(0, lineStart)}${replacement}${source.slice(lineEnd)}`,
    selectionStart: lineStart + prefix.length,
    selectionEnd: lineStart + replacement.length
  };
}

export function applyMarkdownOrderedList(value, start, end) {
  const source = String(value || '');
  const lineStart = source.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const nextBreak = source.indexOf('\n', end);
  const lineEnd = nextBreak < 0 ? source.length : nextBreak;
  const selected = source.slice(lineStart, lineEnd);
  const replacement = selected.split('\n').map((line, index) => `${index + 1}. ${line.replace(/^\d+\.\s+/, '')}`).join('\n');
  return {
    value: `${source.slice(0, lineStart)}${replacement}${source.slice(lineEnd)}`,
    selectionStart: lineStart + 3,
    selectionEnd: lineStart + replacement.length
  };
}

export function insertMarkdownBlock(value, start, end, block) {
  const source = String(value || '');
  const before = start > 0 && source[start - 1] !== '\n' ? '\n' : '';
  const after = end < source.length && source[end] !== '\n' ? '\n' : '';
  const insertion = `${before}${block}${after}`;
  return {
    value: `${source.slice(0, start)}${insertion}${source.slice(end)}`,
    selectionStart: start + before.length,
    selectionEnd: start + before.length + block.length
  };
}
