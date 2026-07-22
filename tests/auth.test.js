import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { resetDbForTests } from '../src/storage/db.js';
import { getSetting } from '../src/models/session.js';
import { authStatus, authSummary, saveAuthCredentials, verifyAuthCredentials } from '../src/models/auth.js';
import { handleSettingsApi } from '../src/routes/settings.js';
import { createAppServer } from '../src/server.js';

const appJs = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const appContextJs = readFileSync(new URL('../public/app-context.js', import.meta.url), 'utf8');
const authSettingsPanelJs = readFileSync(new URL('../public/app-runtime/settings/AuthSettingsPanel.js', import.meta.url), 'utf8');

test('auth credentials are stored as salted hashes and not exposed in settings', async () => {
  const dbPath = join(process.cwd(), 'data', 'test-auth-settings.sqlite');
  rmSync(dbPath, { force: true });
  resetDbForTests(dbPath);

  await saveAuthCredentials({ username: 'admin', password: 'secret-pass' });
  const stored = getSetting('auth');
  assert.equal(stored.username, 'admin');
  assert.notEqual(stored.passwordHash, 'secret-pass');
  assert.match(stored.passwordHash, /^scrypt\$/);
  assert.equal(await verifyAuthCredentials('admin', 'secret-pass'), true);
  assert.equal(await verifyAuthCredentials('admin', 'wrong'), false);
  assert.deepEqual(authSummary(), { enabled: true, username: 'admin' });

  const response = mockResponse();
  await handleSettingsApi({}, response, 'GET');
  const body = JSON.parse(response.body);
  assert.deepEqual(body.auth, { enabled: true, username: 'admin' });
  assert.doesNotMatch(response.body, /secret-pass/);
  assert.doesNotMatch(response.body, /passwordHash/);
});

test('setting credentials clears the session so the user must log in again', async () => {
  const dbPath = join(process.cwd(), 'data', 'test-auth-save-cookie.sqlite');
  rmSync(dbPath, { force: true });
  resetDbForTests(dbPath);

  const response = mockResponse();
  await handleSettingsApi(mockJsonRequest({ auth: { username: 'owner', password: 'new-pass' } }), response, 'PUT');
  const body = JSON.parse(response.body);
  assert.deepEqual(body.auth, { enabled: true, username: 'owner' });
  assert.match(response.headers['set-cookie'], /luban_session=;/);
  assert.match(response.headers['set-cookie'], /HttpOnly/);
  assert.equal(authStatus({ headers: { cookie: response.headers['set-cookie'] } }).authenticated, false);
});

test('updating credentials invalidates old sessions', async () => {
  const dbPath = join(process.cwd(), 'data', 'test-auth-session-rotation.sqlite');
  rmSync(dbPath, { force: true });
  resetDbForTests(dbPath);

  await saveAuthCredentials({ username: 'owner', password: 'old-pass' });
  const response = mockResponse();
  await handleSettingsApi(mockJsonRequest({ auth: { username: 'owner', password: 'new-pass' } }), response, 'PUT');
  const cookie = response.headers['set-cookie'];
  assert.equal(authStatus({ headers: { cookie } }).authenticated, false);

  await saveAuthCredentials({ username: 'owner', password: 'newer-pass' });
  assert.equal(authStatus({ headers: { cookie } }).authenticated, false);
});

test('HTTP auth gates protected APIs once credentials are configured', async () => {
  const dbPath = join(process.cwd(), 'data', 'test-auth-http.sqlite');
  rmSync(dbPath, { force: true });
  resetDbForTests(dbPath);
  await saveAuthCredentials({ username: 'admin', password: 'secret-pass' });

  const server = createAppServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    const blocked = await fetch(`${base}/api/apps`);
    assert.equal(blocked.status, 401);

    const badLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrong' })
    });
    assert.equal(badLogin.status, 401);

    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'secret-pass' })
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie');
    assert.match(cookie, /luban_session=/);

    const allowed = await fetch(`${base}/api/apps`, { headers: { cookie } });
    assert.equal(allowed.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('frontend redirects to login after saving credentials and shows user controls in topbar', () => {
  assert.match(authSettingsPanelJs, /auth-login-required/);
  assert.match(appJs, /renderLogin\(root, boot\)/);
  assert.match(appJs, /querySelectorAll\('\.modal-backdrop'\)/);
  assert.match(appContextJs, /topbar-username/);
  assert.match(appContextJs, /topbar-logout-button/);
  assert.match(appContextJs, /\/api\/auth\/logout/);
});

function mockResponse() {
  return {
    status: 0,
    body: '',
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    writeHead(status, headers = {}) {
      this.status = status;
      Object.assign(this.headers, Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])));
    },
    end(body = '') { this.body = String(body); }
  };
}

function mockJsonRequest(body) {
  const request = new PassThrough();
  const text = JSON.stringify(body);
  request.headers = { 'content-length': String(Buffer.byteLength(text)) };
  request.end(text);
  return request;
}
