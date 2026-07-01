const actions = { loadApps: async () => {}, openApp: async () => {} };
export function configureHomeActions(next = {}) { Object.assign(actions, next); }
export function loadApps(...args) { return actions.loadApps(...args); }
export function openApp(...args) { return actions.openApp(...args); }
