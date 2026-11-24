export async function assertModelResponse(response) {
  if (response.ok) return response;
  const raw = await response.text().catch(() => '');
  let detail = raw;
  try {
    const parsed = JSON.parse(raw);
    detail = parsed?.error?.message ?? parsed?.message ?? raw;
  } catch {}
  const safe = String(detail).replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED]').slice(0, 1000);
  const error = new Error(`Model request failed: HTTP ${response.status}${safe ? ` ${safe}` : ''}`);
  error.status = response.status;
  error.retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
  throw error;
}

export function joinUrl(baseUrl, path) {
  return `${String(baseUrl).replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
