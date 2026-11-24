const PROVIDERS = new Set(['openai-compatible', 'anthropic']);

function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value;
}

function string(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

function stringArray(value, field) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new TypeError(`${field} must be an array of non-empty strings`);
  }
  return [...new Set(value)];
}

function clone(value) {
  return structuredClone(value);
}

export function validateRuntimeConfig(input) {
  const config = clone(object(input, 'runtime_config'));
  if (config.schema_version !== 1) throw new Error('Unsupported RuntimeConfig schema_version');

  object(config.product, 'product');
  string(config.product.id, 'product.id');
  string(config.product.version, 'product.version');
  string(config.product.instance_id, 'product.instance_id');

  object(config.agent, 'agent');
  string(config.agent.id, 'agent.id');
  string(config.agent.version, 'agent.version');
  string(config.agent.package_path, 'agent.package_path');

  object(config.model, 'model');
  string(config.model.provider, 'model.provider');
  if (!PROVIDERS.has(config.model.provider)) {
    throw new Error(`Unsupported model provider: ${config.model.provider}`);
  }
  string(config.model.model, 'model.model');
  string(config.model.credential_ref, 'model.credential_ref');
  if (!config.model.credential_ref.startsWith('secret:')) {
    throw new Error('model.credential_ref must be a secret reference');
  }
  if (config.model.base_url !== undefined) string(config.model.base_url, 'model.base_url');
  object(config.model.capabilities, 'model.capabilities');

  object(config.tools, 'tools');
  config.tools.allowed = stringArray(config.tools.allowed, 'tools.allowed');
  config.tools.denied = stringArray(config.tools.denied ?? [], 'tools.denied');
  const denied = new Set(config.tools.denied);
  config.tools.allowed = config.tools.allowed.filter(name => !denied.has(name));

  config.skills ??= { enabled: [] };
  object(config.skills, 'skills');
  config.skills.enabled = stringArray(config.skills.enabled ?? [], 'skills.enabled');

  config.mcp ??= { servers: [] };
  object(config.mcp, 'mcp');
  config.mcp.servers = stringArray(config.mcp.servers ?? [], 'mcp.servers');

  config.limits ??= {};
  object(config.limits, 'limits');
  for (const field of ['max_turns', 'timeout_seconds']) {
    if (config.limits[field] !== undefined &&
        (!Number.isSafeInteger(config.limits[field]) || config.limits[field] <= 0)) {
      throw new TypeError(`limits.${field} must be a positive safe integer`);
    }
  }
  return config;
}

export function effectiveToolPermissions(config, runAllowed = null) {
  const normalized = validateRuntimeConfig(config);
  const productAllowed = new Set(normalized.tools.allowed);
  if (runAllowed === null) return [...productAllowed];
  return stringArray(runAllowed, 'run_allowed_tools').filter(name => productAllowed.has(name));
}
