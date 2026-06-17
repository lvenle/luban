export function readStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function globalStorageKey(scope) {
  return `software-garden:${scope}`;
}

export function clampSidebarWidth(value) {
  return Math.max(132, Math.min(360, Number(value) || 168));
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || min));
}
