function required(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} is required`);
  return value;
}

export class ChannelRegistry {
  #connectors = new Map();
  #leases = new Map();

  constructor({ onAudit = () => {} } = {}) {
    this.onAudit = onAudit;
  }

  register(connector) {
    if (!connector || typeof connector !== 'object') throw new TypeError('connector must be an object');
    required(connector.id, 'connector.id');
    required(connector.type, 'connector.type');
    if (typeof connector.send !== 'function') throw new TypeError('connector.send is required');
    if (this.#connectors.has(connector.id)) throw new Error(`Connector already registered: ${connector.id}`);
    this.#connectors.set(connector.id, Object.freeze({ capabilities: [], ...connector }));
    return () => this.unregister(connector.id);
  }

  unregister(connectorId) {
    if ([...this.#leases.values()].some(lease => lease.connectorId === connectorId)) {
      throw new Error(`Cannot unregister active connector: ${connectorId}`);
    }
    return this.#connectors.delete(connectorId);
  }

  activate({ productInstanceId, exclusiveGroup, connectorId }) {
    required(productInstanceId, 'productInstanceId');
    required(exclusiveGroup, 'exclusiveGroup');
    const connector = this.#connectors.get(required(connectorId, 'connectorId'));
    if (!connector) throw new Error(`Connector not found: ${connectorId}`);
    if (connector.exclusiveGroup && connector.exclusiveGroup !== exclusiveGroup) {
      throw new Error(`Connector does not belong to exclusive group: ${exclusiveGroup}`);
    }
    const key = `${productInstanceId}:${exclusiveGroup}`;
    const previous = this.#leases.get(key);
    const lease = Object.freeze({
      productInstanceId,
      exclusiveGroup,
      connectorId,
      activatedAt: new Date().toISOString()
    });
    this.#leases.set(key, lease);
    this.onAudit({ type: 'channel_activated', lease, previous: previous ?? null });
    return { lease, previous: previous ?? null };
  }

  deactivate({ productInstanceId, exclusiveGroup }) {
    const key = `${required(productInstanceId, 'productInstanceId')}:${required(exclusiveGroup, 'exclusiveGroup')}`;
    const previous = this.#leases.get(key);
    if (!previous) return false;
    this.#leases.delete(key);
    this.onAudit({ type: 'channel_deactivated', lease: previous });
    return true;
  }

  active(productInstanceId, exclusiveGroup) {
    return this.#leases.get(`${productInstanceId}:${exclusiveGroup}`) ?? null;
  }

  accept(event) {
    if (!event || typeof event !== 'object') throw new TypeError('event must be an object');
    const lease = this.active(event.product_instance_id, event.exclusive_group);
    if (!lease || lease.connectorId !== event.connector_id) return false;
    this.onAudit({ type: 'channel_event_accepted', event_id: event.event_id, lease });
    return true;
  }

  async send({ productInstanceId, exclusiveGroup, action, signal }) {
    const lease = this.active(productInstanceId, exclusiveGroup);
    if (!lease) throw new Error(`No active connector for group: ${exclusiveGroup}`);
    const connector = this.#connectors.get(lease.connectorId);
    if (!connector) throw new Error(`Active connector is unavailable: ${lease.connectorId}`);
    const result = await connector.send(action, { signal });
    this.onAudit({ type: 'channel_action_completed', lease, action_id: action?.action_id, result });
    return result;
  }

  async healthCheck() {
    const results = [];
    for (const connector of this.#connectors.values()) {
      try {
        const detail = typeof connector.healthCheck === 'function' ? await connector.healthCheck() : null;
        results.push({ connectorId: connector.id, healthy: true, detail });
      } catch (error) {
        results.push({ connectorId: connector.id, healthy: false, error: error.message });
      }
    }
    return results;
  }
}
