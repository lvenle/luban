import { humanizeMessage } from './messages.js';

export async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body instanceof ArrayBuffer ? options.headers : { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    const technicalMessage = body.error || '请求失败';
    const error = new Error(humanizeMessage(technicalMessage));
    error.technicalMessage = technicalMessage;
    error.status = response.status;
    error.details = body.details;
    throw error;
  }
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return response.json();
  return response;
}
