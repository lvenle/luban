import { readStorage, writeStorage, globalStorageKey, clampSidebarWidth } from '../common/storage.js';
import { state } from '../app.js';
import { renderRuntime } from './index.js';

export function toggleSidebarCollapsed() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  saveSidebarLayout();
  renderRuntime();
}

export function startSidebarResize(event) {
  if (state.sidebarCollapsed) {
    toggleSidebarCollapsed();
    return;
  }
  event.preventDefault();
  const startX = event.clientX;
  const startWidth = state.sidebarWidth;
  const controller = new AbortController();
  document.body.classList.add('resizing-sidebar');
  const update = (moveEvent) => {
    state.sidebarWidth = clampSidebarWidth(startWidth + moveEvent.clientX - startX);
    document.querySelector('.runtime')?.style.setProperty('--sidebar-width', `${state.sidebarWidth}px`);
  };
  const finish = () => {
    document.body.classList.remove('resizing-sidebar');
    saveSidebarLayout();
    controller.abort();
  };
  document.addEventListener('pointermove', update, { signal: controller.signal });
  document.addEventListener('pointerup', finish, { once: true, signal: controller.signal });
  document.addEventListener('pointercancel', finish, { once: true, signal: controller.signal });
}

export function loadSidebarLayout() {
  state.sidebarCollapsed = Boolean(readStorage(globalStorageKey('sidebar-collapsed'), false));
  state.sidebarWidth = clampSidebarWidth(readStorage(globalStorageKey('sidebar-width'), 168));
}

export function saveSidebarLayout() {
  writeStorage(globalStorageKey('sidebar-collapsed'), state.sidebarCollapsed);
  writeStorage(globalStorageKey('sidebar-width'), state.sidebarWidth);
}
