import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const PROFILE_FILE = path.join(DATA, 'profiles.json');
const PORT = Number(process.env.PORT || 3000);
const MAX_BODY = 1024 * 1024;

export const endpoints = Object.freeze({
  info: { method: 'GET', path: 'info' },
  players: { method: 'GET', path: 'players' },
  settings: { method: 'GET', path: 'settings' },
  metrics: { method: 'GET', path: 'metrics' },
  gameData: { method: 'GET', path: 'game-data' },
  announce: { method: 'POST', path: 'announce', fields: ['message'] },
  kick: { method: 'POST', path: 'kick', fields: ['userid', 'message'] },
  ban: { method: 'POST', path: 'ban', fields: ['userid', 'message'] },
  unban: { method: 'POST', path: 'unban', fields: ['userid'] },
  save: { method: 'POST', path: 'save' },
  shutdown: { method: 'POST', path: 'shutdown', fields: ['waittime', 'message'] },
  stop: { method: 'POST', path: 'stop' }
});

const json = (res, status, value) => {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
  res.end(body);
};

async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('Request body is too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Invalid JSON body'); }
}

async function profiles() {
  try {
    const value = JSON.parse(await readFile(PROFILE_FILE, 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function saveProfiles(value) {
  await mkdir(DATA, { recursive: true });
  await writeFile(PROFILE_FILE, JSON.stringify(value, null, 2), { mode: 0o600 });
}

function sanitizeProfile(input, existing = {}) {
  const name = String(input.name || '').trim();
  let url = String(input.url || '').trim().replace(/\/+$/, '');
  const username = String(input.username || '').trim();
  const password = input.password === undefined ? existing.password || '' : String(input.password);
  if (!name) throw new Error('Profile name is required');
  if (!url) throw new Error('Server URL is required');
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only HTTP and HTTPS server URLs are supported');
  if (!parsed.pathname.endsWith('/v1/api')) parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/v1/api`;
  parsed.search = '';
  parsed.hash = '';
  return { id: existing.id || crypto.randomUUID(), name, url: parsed.toString().replace(/\/$/, ''), username, password };
}

function publicProfile(profile) {
  return { id: profile.id, name: profile.name, url: profile.url, username: profile.username, hasPassword: Boolean(profile.password) };
}

async function proxy(req, res, id, action) {
  const endpoint = endpoints[action];
  if (!endpoint) return json(res, 404, { error: 'Unsupported Palworld endpoint' });
  const profile = (await profiles()).find(item => item.id === id);
  if (!profile) return json(res, 404, { error: 'Profile not found' });
  const payload = endpoint.method === 'POST' ? await body(req) : undefined;
  const requestBody = endpoint.fields ? Object.fromEntries(endpoint.fields.filter(k => payload[k] !== undefined && payload[k] !== '').map(k => [k, k === 'waittime' ? Number(payload[k]) : payload[k]])) : undefined;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const upstream = await fetch(`${profile.url}/${endpoint.path}`, {
      method: endpoint.method,
      headers: {
        accept: 'application/json',
        ...(endpoint.method === 'POST' ? { 'content-type': 'application/json' } : {}),
        authorization: `Basic ${Buffer.from(`${profile.username}:${profile.password}`).toString('base64')}`
      },
      body: endpoint.method === 'POST' && endpoint.fields ? JSON.stringify(requestBody) : undefined,
      signal: controller.signal
    });
    const text = await upstream.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch { data = text; } }
    json(res, upstream.status, { ok: upstream.ok, status: upstream.status, data });
  } catch (error) {
    json(res, 502, { error: error.name === 'AbortError' ? 'Palworld server timed out' : `Could not reach Palworld server: ${error.message}` });
  } finally { clearTimeout(timeout); }
}

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
function staticFile(req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.resolve(PUBLIC, relative);
  if (!file.startsWith(path.resolve(PUBLIC)) || !existsSync(file)) return false;
  res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  createReadStream(file).pipe(res);
  return true;
}

export async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.pathname === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true });
    if (url.pathname === '/api/endpoints' && req.method === 'GET') return json(res, 200, endpoints);
    if (url.pathname === '/api/profiles' && req.method === 'GET') return json(res, 200, (await profiles()).map(publicProfile));
    if (url.pathname === '/api/profiles' && req.method === 'POST') {
      const value = await profiles();
      const profile = sanitizeProfile(await body(req));
      value.push(profile); await saveProfiles(value);
      return json(res, 201, publicProfile(profile));
    }
    if (parts[0] === 'api' && parts[1] === 'profiles' && parts[2] && parts.length === 3) {
      const value = await profiles();
      const index = value.findIndex(item => item.id === parts[2]);
      if (index < 0) return json(res, 404, { error: 'Profile not found' });
      if (req.method === 'PUT') {
        value[index] = sanitizeProfile(await body(req), value[index]); await saveProfiles(value);
        return json(res, 200, publicProfile(value[index]));
      }
      if (req.method === 'DELETE') { value.splice(index, 1); await saveProfiles(value); res.writeHead(204); return res.end(); }
    }
    if (parts[0] === 'api' && parts[1] === 'palworld' && parts[2] && parts[3]) return proxy(req, res, parts[2], parts[3]);
    if (req.method === 'GET' && staticFile(req, res, url.pathname)) return;
    json(res, 404, { error: 'Not found' });
  } catch (error) { json(res, 400, { error: error.message || 'Request failed' }); }
}

if (process.env.NODE_ENV !== 'test') {
  await mkdir(DATA, { recursive: true });
  http.createServer(handler).listen(PORT, '0.0.0.0', () => console.log(`Palworld Connect listening on http://0.0.0.0:${PORT}`));
}
