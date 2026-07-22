import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { getSetting, setSetting } from './session.js';
import { badRequest } from '../core/errors.js';

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = 'luban_session';
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const sessions = new Map();

export function authSummary() {
  const auth = getAuthSetting();
  return {
    enabled: Boolean(auth.username && auth.passwordHash),
    username: auth.username || ''
  };
}

export function authStatus(req) {
  const summary = authSummary();
  const session = currentAuthSession(req);
  const authenticated = !summary.enabled || Boolean(session);
  return {
    ...summary,
    username: authenticated ? summary.username : '',
    required: summary.enabled,
    authenticated
  };
}

export async function saveAuthCredentials(input = {}) {
  const username = String(input.username || '').trim();
  const password = String(input.password || '');
  if (!username) throw badRequest('用户名不能为空。');
  if (!password) throw badRequest('密码不能为空。');
  const passwordHash = await hashPassword(password);
  sessions.clear();
  setSetting('auth', { username, passwordHash });
  return authSummary();
}

export async function verifyAuthCredentials(username, password) {
  const auth = getAuthSetting();
  if (!auth.username || !auth.passwordHash) return true;
  if (String(username || '').trim() !== auth.username) return false;
  return verifyPassword(String(password || ''), auth.passwordHash);
}

export function requireAuthenticated(req) {
  const status = authStatus(req);
  if (status.authenticated) return status;
  const error = new Error('请先登录。');
  error.status = 401;
  throw error;
}

export function createAuthSession(res, username) {
  const token = randomBytes(32).toString('base64url');
  sessions.set(token, { username, expiresAt: Date.now() + SESSION_MAX_AGE_SECONDS * 1000 });
  res.setHeader('set-cookie', serializeCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS
  }));
}

export function clearAuthSession(req, res) {
  const token = parseCookies(req.headers?.cookie || '')[SESSION_COOKIE];
  if (token) sessions.delete(token);
  res.setHeader('set-cookie', serializeCookie(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 0
  }));
}

function currentAuthSession(req) {
  const token = parseCookies(req.headers?.cookie || '')[SESSION_COOKIE];
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function getAuthSetting() {
  const auth = getSetting('auth') || {};
  return {
    username: String(auth.username || ''),
    passwordHash: String(auth.passwordHash || '')
  };
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url');
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${Buffer.from(hash).toString('base64url')}`;
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expectedHash] = parts;
  const expected = Buffer.from(expectedHash, 'base64url');
  const actual = await scrypt(password, salt, expected.length);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }
  return cookies;
}

function serializeCookie(name, value, options = {}) {
  const segments = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) segments.push(`Max-Age=${Math.max(0, Number(options.maxAge) || 0)}`);
  if (options.path) segments.push(`Path=${options.path}`);
  if (options.httpOnly) segments.push('HttpOnly');
  if (options.sameSite) segments.push(`SameSite=${options.sameSite}`);
  return segments.join('; ');
}
