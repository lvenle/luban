const BLOCK_TAGS = /<\/?(?:address|article|aside|blockquote|br|dd|div|dl|dt|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|tfoot|thead|tr|ul)\b[^>]*>/gi;
const SKIPPED_CONTENT = /<(script|style|head|noscript|template|svg|canvas)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const ENTITIES = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™' };

function decodeEntity(entity) {
  if (entity[1] === '#') {
    const hex = entity[2]?.toLowerCase() === 'x';
    const code = Number.parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return ' ';
    try { return String.fromCodePoint(code); } catch { return ' '; }
  }
  return ENTITIES[entity.slice(1, -1).toLowerCase()] ?? ' ';
}

/** Extract human-readable document text from HTML without retaining markup or executable/style source. */
export function htmlToText(html) {
  return String(html ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ' ')
    .replace(SKIPPED_CONTENT, ' ')
    .replace(/<h([1-6])\b[^>]*>/gi, (_, level) => `\n${'#'.repeat(Number(level))} `)
    .replace(/<\/h[1-6]\s*>/gi, '\n')
    .replace(/<\/(?:td|th)\s*>/gi, ' | ')
    .replace(BLOCK_TAGS, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/gi, decodeEntity)
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
