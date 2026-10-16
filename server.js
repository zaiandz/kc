#!/usr/bin/env node
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { parseDocument, PARSER_VERSION } = require('./document-parser');
const APP_VERSION = 5;

const ROOT_DIR = __dirname;
function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : '';
}
const requestedDataDirectory = argumentValue('--data-dir') || process.env.JINCANG_DATA_DIR || '';
const DATA_DIR = requestedDataDirectory
  ? path.resolve(requestedDataDirectory)
  : path.join(ROOT_DIR, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const IMPORT_DIR = path.join(DATA_DIR, 'imports');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const HOST = '127.0.0.1';
const START_PORT = Number(argumentValue('--port') || process.env.PORT || 3210);
const MAX_BODY_BYTES = 50 * 1024 * 1024;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8'
};

function ensureDirectories() {
  [DATA_DIR, IMPORT_DIR, BACKUP_DIR].forEach((directory) => {
    fs.mkdirSync(directory, { recursive: true });
  });
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(body);
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  response.end(text);
}

function readState() {
  if (!fs.existsSync(STATE_FILE)) return null;
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    const brokenFile = path.join(DATA_DIR, 'state-broken-' + Date.now() + '.json');
    try { fs.copyFileSync(STATE_FILE, brokenFile); } catch (_) {}
    throw new Error('state.json 格式损坏，已保留副本：' + path.basename(brokenFile));
  }
}

function timestampPart(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate()) + '-' + pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds());
}

function writeAtomic(filePath, content) {
  const temporary = filePath + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(temporary, content, 'utf8');
  fs.renameSync(temporary, filePath);
}

function pruneHourlyBackups() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter((name) => /^state-\d{8}-\d{2}\.json$/.test(name))
      .sort();
    files.slice(0, Math.max(0, files.length - 72)).forEach((name) => {
      fs.rmSync(path.join(BACKUP_DIR, name), { force: true });
    });
  } catch (_) {}
}

function writeState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('保存内容必须是 JSON 对象');
  }
  ensureDirectories();
  const now = new Date();
  const hourlyBackup = path.join(BACKUP_DIR, 'state-' + now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0') + '-' + String(now.getHours()).padStart(2, '0') + '.json');
  if (!fs.existsSync(hourlyBackup) && fs.existsSync(STATE_FILE)) {
    try { fs.copyFileSync(STATE_FILE, hourlyBackup); } catch (_) {}
  }
  writeAtomic(STATE_FILE, JSON.stringify(state, null, 2));
  pruneHourlyBackups();
  return { savedAt: new Date().toISOString(), bytes: fs.statSync(STATE_FILE).size };
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('上传内容超过 50MB 限制'), { statusCode: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (_) {
        reject(Object.assign(new Error('请求内容不是有效 JSON'), { statusCode: 400 }));
      }
    });
    request.on('error', reject);
  });
}

function safeImportName(filename) {
  const base = path.basename(String(filename || 'backup.json')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  return base.endsWith('.json') ? base : base + '.json';
}

async function handleApi(request, response, pathname) {
  if (pathname === '/api/health' && request.method === 'GET') {
    let writable = false;
    try {
      ensureDirectories();
      const probe = path.join(DATA_DIR, '.write-test-' + process.pid);
      fs.writeFileSync(probe, 'ok', 'utf8');
      fs.rmSync(probe, { force: true });
      writable = true;
    } catch (_) {}
    return sendJson(response, 200, {
      ok: true,
      service: 'jincang-folder-storage',
      appVersion: APP_VERSION,
      parserVersion: PARSER_VERSION,
      capabilities: ['folder-storage', 'parse-document', 'xlsx', 'xlsm', 'docx', 'docm'],
      writable,
      dataDirectory: DATA_DIR,
      stateFile: STATE_FILE,
      relativeStateFile: path.relative(ROOT_DIR, STATE_FILE).replace(/\\/g, '/'),
      importDirectory: IMPORT_DIR,
      pid: process.pid
    });
  }

  if (pathname === '/api/state' && request.method === 'GET') {
    try {
      const state = readState();
      return sendJson(response, 200, { ok: true, exists: Boolean(state), state, savedAt: state ? state.updatedAt || null : null });
    } catch (error) {
      return sendJson(response, 500, { ok: false, error: error.message });
    }
  }

  if (pathname === '/api/state' && ['PUT', 'POST'].includes(request.method)) {
    try {
      const body = await readJsonBody(request);
      const state = body && body.state ? body.state : body;
      const result = writeState(state);
      return sendJson(response, 200, { ok: true, ...result, stateFile: STATE_FILE });
    } catch (error) {
      return sendJson(response, error.statusCode || 400, { ok: false, error: error.message });
    }
  }

  if (pathname === '/api/parse-document' && request.method === 'POST') {
    try {
      const body = await readJsonBody(request);
      const filename = String(body.filename || '');
      const contentBase64 = String(body.contentBase64 || '');
      if (!filename || !contentBase64) throw Object.assign(new Error('缺少文件名或文件内容'), { statusCode: 400 });
      const buffer = Buffer.from(contentBase64, 'base64');
      if (!buffer.length) throw Object.assign(new Error('文件内容为空'), { statusCode: 400 });
      const parsed = parseDocument(buffer, filename);
      return sendJson(response, 200, { ok: true, ...parsed });
    } catch (error) {
      return sendJson(response, error.statusCode || 400, { ok: false, error: error.message });
    }
  }

  if (pathname === '/api/import' && request.method === 'POST') {
    try {
      const body = await readJsonBody(request);
      if (!body || typeof body.rawContent !== 'string') throw Object.assign(new Error('缺少原始备份内容'), { statusCode: 400 });
      ensureDirectories();
      const filename = timestampPart() + '-' + safeImportName(body.filename);
      const target = path.join(IMPORT_DIR, filename);
      fs.writeFileSync(target, body.rawContent, 'utf8');
      let saveResult = null;
      if (body.state) saveResult = writeState(body.state);
      return sendJson(response, 200, {
        ok: true,
        archivedFile: target,
        relativeArchivedFile: path.relative(ROOT_DIR, target).replace(/\\/g, '/'),
        saveResult
      });
    } catch (error) {
      return sendJson(response, error.statusCode || 400, { ok: false, error: error.message });
    }
  }

  return sendJson(response, 404, { ok: false, error: 'API 接口不存在' });
}

function handleStatic(request, response, pathname) {
  if (!['GET', 'HEAD'].includes(request.method)) return sendText(response, 405, 'Method Not Allowed');
  if (pathname === '/favicon.ico') {
    response.writeHead(204);
    return response.end();
  }

  const relativePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const target = path.resolve(ROOT_DIR, relativePath);
  const allowedPrefix = ROOT_DIR.endsWith(path.sep) ? ROOT_DIR : ROOT_DIR + path.sep;
  if (target !== ROOT_DIR && !target.startsWith(allowedPrefix)) return sendText(response, 403, 'Forbidden');
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return sendText(response, 404, 'Not Found');

  const extension = path.extname(target).toLowerCase();
  const stat = fs.statSync(target);
  response.writeHead(200, {
    'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': extension === '.html' ? 'no-store' : 'no-cache',
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff'
  });
  if (request.method === 'HEAD') return response.end();
  fs.createReadStream(target).pipe(response);
}

function createServer() {
  return http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, 'http://' + HOST);
    const pathname = requestUrl.pathname;
    try {
      if (request.method === 'OPTIONS') {
        response.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
        return response.end();
      }
      if (pathname.startsWith('/api/')) return await handleApi(request, response, pathname);
      return handleStatic(request, response, pathname);
    } catch (error) {
      console.error('[server]', error);
      if (!response.headersSent) sendJson(response, 500, { ok: false, error: '服务器内部错误' });
      else response.destroy();
    }
  });
}

function openBrowser(address) {
  setTimeout(() => {
    try {
      if (process.platform === 'win32') {
        const child = spawn('cmd.exe', ['/c', 'start', '', address], { detached: true, stdio: 'ignore', windowsHide: true });
        child.unref();
      } else if (process.platform === 'darwin') {
        spawn('open', [address], { detached: true, stdio: 'ignore' }).unref();
      } else {
        spawn('xdg-open', [address], { detached: true, stdio: 'ignore' }).unref();
      }
    } catch (error) {
      console.error('[server] 无法自动打开浏览器：', error.message);
    }
  }, 320);
}

function requestHealth(port) {
  return new Promise((resolve) => {
    const request = http.get({ host: HOST, port, path: '/api/health', timeout: 450 }, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (_) { resolve(null); }
      });
    });
    request.on('error', () => resolve(null));
    request.on('timeout', () => { request.destroy(); resolve(null); });
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function reclaimPreviousInstance() {
  for (let port = START_PORT; port <= START_PORT + 20; port += 1) {
    const health = await requestHealth(port);
    if (!health || health.service !== 'jincang-folder-storage') continue;
    const sameDataDirectory = !health.dataDirectory || path.resolve(health.dataDirectory) === path.resolve(DATA_DIR);
    if (!sameDataDirectory) continue;
    if (health.appVersion === APP_VERSION && health.parserVersion === PARSER_VERSION) {
      const address = 'http://' + HOST + ':' + port;
      console.log('');
      console.log('湖北视感闪租相机库存管理已经在运行');
      console.log('访问地址：' + address);
      console.log('数据文件：' + STATE_FILE);
      console.log('');
      if (process.argv.includes('--open') && process.env.JINCANG_NO_BROWSER !== '1') openBrowser(address);
      await wait(500);
      process.exit(0);
    }
    if (health.pid) {
      console.log('[server] 检测到旧版服务，正在自动重启（PID ' + health.pid + '）…');
      try { process.kill(health.pid, 'SIGTERM'); } catch (_) {}
      await wait(650);
    }
  }
}

function listen(port, attempts = 0) {
  const server = createServer();
  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE' && attempts < 20) {
      console.warn('[server] 端口 ' + port + ' 已占用，尝试 ' + (port + 1));
      setTimeout(() => listen(port + 1, attempts + 1), 80);
      return;
    }
    console.error('[server] 启动失败：', error.message);
    process.exitCode = 1;
  });
  server.listen(port, HOST, () => {
    const address = 'http://' + HOST + ':' + port;
    ensureDirectories();
    console.log('');
    console.log('湖北视感闪租相机库存管理已启动');
    console.log('访问地址：' + address);
    console.log('数据文件：' + STATE_FILE);
    console.log('按 Ctrl+C 停止服务');
    console.log('');
    if (process.argv.includes('--open')) openBrowser(address);
  });
}

process.on('SIGINT', () => {
  console.log('\n[server] 服务已停止，数据已保存到 ' + STATE_FILE);
  process.exit(0);
});
process.on('SIGTERM', () => process.exit(0));

reclaimPreviousInstance().finally(() => listen(START_PORT));

