import { handlePlatformChat } from './platform-chat.js';

/** Compatibility route; chat execution lives exclusively in Agent Platform. */
export function handleChat(req, res, method, parts) {
  if (method !== 'POST' || parts.length !== 3 || parts[2] !== 'chat') return false;
  return handlePlatformChat(req, res, method, ['api', 'ai', 'platform-chat']);
}
