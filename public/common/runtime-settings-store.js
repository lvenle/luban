import { normalizeRuntimeSettings } from './runtime-settings.js';

let currentRuntimeSettings = normalizeRuntimeSettings();

export function getClientRuntimeSettings() {
  return currentRuntimeSettings;
}

export function setClientRuntimeSettings(next = {}) {
  currentRuntimeSettings = normalizeRuntimeSettings(next);
  return currentRuntimeSettings;
}
