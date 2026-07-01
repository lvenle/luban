const actions = {
  renderRuntime: () => {},
  loadCurrentPageRecords: async () => {},
  saveCurrentPackage: async () => {},
  renderInfiniteLoadSentinel: () => null
};

export function configureRuntimeActions(next = {}) { Object.assign(actions, next); }
export function renderRuntime(...args) { return actions.renderRuntime(...args); }
export function loadCurrentPageRecords(...args) { return actions.loadCurrentPageRecords(...args); }
export function saveCurrentPackage(...args) { return actions.saveCurrentPackage(...args); }
export function renderInfiniteLoadSentinel(...args) { return actions.renderInfiniteLoadSentinel(...args); }
