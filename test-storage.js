'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = __dirname;
const serverFile = path.join(root, 'server.js');
const tempRoot = path.resolve(os.tmpdir());
const testDataDir = path.join(tempRoot, 'jincang-storage-test-' + process.pid + '-' + Date.now());
let basePort = 3600 + Math.floor(Math.random() * 800);
let activeChild = null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
  return { response, body, text };
}

async function startServer(port) {
  const child = spawn(process.execPath, [serverFile], {
    cwd: root,
    env: { ...process.env, PORT: String(port), JINCANG_DATA_DIR: testDataDir },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  activeChild = child;
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error('服务提前退出：' + stderr);
    try {
      const result = await request('http://127.0.0.1:' + port + '/api/health');
      if (result.response.ok && result.body?.ok) return { child, port };
    } catch (_) {}
    await wait(120);
  }
  throw new Error('服务启动超时：' + stderr);
}

async function stopServer(child) {
  if (!child || child.exitCode != null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) {}
      resolve();
    }, 3000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    try { child.kill('SIGTERM'); } catch (_) { resolve(); }
  });
  if (activeChild === child) activeChild = null;
  await wait(180);
}

function makeState(version, cameraCount) {
  return {
    version: 1,
    isDemo: false,
    testVersion: version,
    models: [{ id: 'test-model', name: '测试型号' }],
    cameras: Array.from({ length: cameraCount }, (_, index) => ({ id: 'CAM-' + index, sn: 'TEST-' + version + '-' + index, modelId: 'test-model' })),
    orders: [],
    activities: [{ id: 'ACT-' + version, type: 'system', title: '测试保存 v' + version, createdAt: new Date().toISOString() }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

async function run() {
  const stateFile = path.join(testDataDir, 'state.json');
  const importDir = path.join(testDataDir, 'imports');
  console.log('测试目录：' + testDataDir);
  console.log('开始第 1 轮：首次启动与创建数据文件');

  let server = await startServer(basePort);
  let result = await request('http://127.0.0.1:' + server.port + '/api/state');
  assert(result.response.ok, '读取空状态失败');
  assert(result.body.exists === false, '首次启动不应存在 state.json');

  for (let version = 1; version <= 12; version += 1) {
    const state = makeState(version, version + 1);
    result = await request('http://127.0.0.1:' + server.port + '/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state)
    });
    assert(result.response.ok && result.body.ok, '第 ' + version + ' 次写入失败');
    await wait(25);
  }
  assert(fs.existsSync(stateFile), 'state.json 未生成');
  const onDisk = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert(onDisk.testVersion === 12, '连续写入后版本不正确');
  assert(onDisk.cameras.length === 13, '连续写入后相机数量不正确');
  console.log('  通过：连续写入 12 次并生成 state.json');

  const invalid = await request('http://127.0.0.1:' + server.port + '/api/state', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: '{bad json'
  });
  assert(invalid.response.status === 400, '无效 JSON 应返回 400');
  console.log('  通过：无效 JSON 返回 400，未覆盖正常数据');

  const traversal = await request('http://127.0.0.1:' + server.port + '/..%2Fserver.js');
  assert([403, 404].includes(traversal.response.status), '目录穿越请求应被拒绝');
  console.log('  通过：静态文件目录穿越被拒绝');

  const rawBackup = JSON.stringify({ imported: true, version: 12 });
  const imported = await request('http://127.0.0.1:' + server.port + '/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: '测试备份.json', rawContent: rawBackup, state: makeState(13, 14) })
  });
  assert(imported.response.ok && imported.body.ok, '导入备份归档失败');
  assert(fs.existsSync(path.join(importDir, path.basename(imported.body.archivedFile))), '导入归档文件不存在');
  console.log('  通过：导入的备份原文件已归档到 imports 文件夹');

  await stopServer(server.child);
  console.log('开始第 2 轮：停止服务后重新启动，验证数据未丢失');

  server = await startServer(basePort);
  result = await request('http://127.0.0.1:' + server.port + '/api/state');
  assert(result.response.ok && result.body.exists, '重启后无法读取状态');
  assert(result.body.state.testVersion === 13, '重启后数据版本不正确');
  assert(result.body.state.cameras.length === 14, '重启后相机数量不正确');
  console.log('  通过：重启后成功恢复最新数据');

  await stopServer(server.child);
  console.log('开始第 3 轮：再次连续保存与重新启动');

  server = await startServer(basePort);
  for (let version = 14; version <= 25; version += 1) {
    const state = makeState(version, version + 1);
    const saved = await request('http://127.0.0.1:' + server.port + '/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state)
    });
    assert(saved.response.ok && saved.body.ok, '第 3 轮写入失败：' + version);
  }
  const finalDisk = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert(finalDisk.testVersion === 25 && finalDisk.cameras.length === 26, '第 3 轮最终数据错误');
  const backups = fs.readdirSync(path.join(testDataDir, 'backups'));
  assert(backups.length >= 1, '未生成小时备份');
  console.log('  通过：再次写入 12 次，最终版本 25，并生成 ' + backups.length + ' 个自动备份');
  await stopServer(server.child);
  console.log('全部存储测试通过。');

  const resolvedData = path.resolve(testDataDir);
  const safePrefix = tempRoot.endsWith(path.sep) ? tempRoot : tempRoot + path.sep;
  if (resolvedData.startsWith(safePrefix) && path.basename(resolvedData).startsWith('jincang-storage-test-')) {
    fs.rmSync(resolvedData, { recursive: true, force: true });
  }
}

run().catch(async (error) => {
  console.error('存储测试失败：' + error.stack);
  await stopServer(activeChild);
  process.exitCode = 1;
});
