import { randomUUID } from 'node:crypto';

export function createId(prefix = 'id') {
  return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 18)}`;
}

export function slugify(input, fallback = 'app') {
  const ascii = String(input || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return ascii || fallback;
}

export function normalizeFieldId(input, fallback = 'field') {
  const id = String(input || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return id || fallback;
}
