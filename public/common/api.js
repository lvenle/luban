import { rememberRelease, releaseHeaders } from './workspace.js';
import { appUrl } from './application-base.js';
import { humanizeMessage } from './messages.js';
import { measureAsync, apiPerfOptions } from './perf.js';

export async function api(path, options = {}) {
  const response = await measureAsync(`api ${options.method || 'GET'}`, () => fetch(appUrl(path), {
      ...options,
      headers: { ...(options.body instanceof ArrayBuffer ? {} : {'content-type':'application/json'}), ...(options.headers||{}), ...releaseHeaders(path,options.method||'GET') }
    }), apiPerfOptions(path));
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
  if (contentType.includes('application/json')) {const body=await response.json();rememberRelease(body.app);return body;}
  return response;
}
