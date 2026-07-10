const desktopNotificationCallbacks = new Map();
let desktopActionUnsubscribe = null;

function desktopNotifications() {
  return window.lubanDesktopNotifications || null;
}

function ensureDesktopActionListener() {
  const bridge = desktopNotifications();
  if (!bridge?.onAction || desktopActionUnsubscribe) return;
  desktopActionUnsubscribe = bridge.onAction((event) => {
    const callback = desktopNotificationCallbacks.get(event.id);
    if (!callback) return;
    if (event.type === 'click') {
      callback.openedFromClick = true;
      callback.onClick?.();
    }
    if (event.type === 'close') {
      desktopNotificationCallbacks.delete(event.id);
      if (callback.openedFromClick) return;
      callback.onClose?.();
    }
  });
}

export async function requestReminderNotificationPermission() {
  const bridge = desktopNotifications();
  if (bridge?.requestPermission) return bridge.requestPermission();
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export async function showReminderNotification({ id, title, body, onClick, onClose }) {
  const bridge = desktopNotifications();
  if (bridge?.show) {
    ensureDesktopActionListener();
    const notificationId = await bridge.show({ id, title, body });
    if (!notificationId) return null;
    desktopNotificationCallbacks.set(notificationId, { onClick, onClose, openedFromClick: false });
    return {
      id: notificationId,
      close: () => {
        desktopNotificationCallbacks.delete(notificationId);
        return bridge.close?.(notificationId);
      }
    };
  }

  if (!('Notification' in window) || Notification.permission !== 'granted') return null;
  const notification = new Notification(title, {
    body,
    tag: `luban-scheduled-reminder:${id}`,
    renotify: true,
    requireInteraction: true
  });
  let openedFromClick = false;
  notification.onclick = () => {
    openedFromClick = true;
    onClick?.();
    notification.close();
  };
  notification.onclose = () => {
    if (!openedFromClick) onClose?.();
  };
  return {
    id,
    close: () => notification.close()
  };
}
