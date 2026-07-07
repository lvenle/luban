import { readStorage, writeStorage, clampSidebarWidth, clampCollapsedSidebarWidth } from '../common/storage.js';
import { state } from '../app-context.js';
import { renderRuntime } from './runtime-actions.js';

function sidebarLayoutKey(name) {
  return `luban-ai:${state.currentApp?.id || 'unknown-app'}:${name}`;
}

export function toggleSidebarCollapsed() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  saveSidebarLayout();
  renderRuntime();
}

export function startSidebarResize(event) {
  event.preventDefault();
  const startX = event.clientX;
  const collapsed = state.sidebarCollapsed;
  const startWidth = collapsed ? state.sidebarCollapsedWidth : state.sidebarWidth;
  const controller = new AbortController();
  document.body.classList.add('resizing-sidebar');
  const update = (moveEvent) => {
    const nextWidth = startWidth + moveEvent.clientX - startX;
    if (collapsed) {
      state.sidebarCollapsedWidth = clampCollapsedSidebarWidth(nextWidth, state.runtimeSettings.sidebarCollapsedWidth);
      document.querySelector('.runtime')?.style.setProperty('--sidebar-collapsed-width', `${state.sidebarCollapsedWidth}px`);
    } else {
      state.sidebarWidth = clampSidebarWidth(nextWidth, state.runtimeSettings.sidebarWidth);
      document.querySelector('.runtime')?.style.setProperty('--sidebar-width', `${state.sidebarWidth}px`);
    }
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
  state.sidebarCollapsed = Boolean(readStorage(sidebarLayoutKey('sidebar-collapsed'), false));
  state.sidebarWidth = clampSidebarWidth(readStorage(sidebarLayoutKey('sidebar-width'), state.runtimeSettings.sidebarWidth), state.runtimeSettings.sidebarWidth);
  state.sidebarCollapsedWidth = clampCollapsedSidebarWidth(readStorage(sidebarLayoutKey('sidebar-collapsed-width'), state.runtimeSettings.sidebarCollapsedWidth), state.runtimeSettings.sidebarCollapsedWidth);
}

export function saveSidebarLayout() {
  writeStorage(sidebarLayoutKey('sidebar-collapsed'), state.sidebarCollapsed);
  writeStorage(sidebarLayoutKey('sidebar-width'), state.sidebarWidth);
  writeStorage(sidebarLayoutKey('sidebar-collapsed-width'), state.sidebarCollapsedWidth);
}
