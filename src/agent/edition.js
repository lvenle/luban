/** Product shape is selected by its trusted host, never by a request parameter. */
export function lubanEdition(value = process.env.LUBAN_EDITION || 'enterprise') {
  if (!['local', 'enterprise'].includes(value)) throw new Error('LUBAN_EDITION 必须是 local 或 enterprise');
  return { id: value, customAgents: value === 'enterprise' };
}
