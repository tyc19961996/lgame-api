import assert from 'node:assert/strict';
import test from 'node:test';
import { LGameAPI } from '../dist/index.js';

globalThis.window = {};
let requests = [], adapterCalls = 0, player = 'A', native;
const ok = (open_id = player, token = `jwt-${open_id}`) => ({ code: 0, data: { open_id, token }, message: 'Success', timestamp: '1760000000000' });
const expired = { code: 402, data: null, message: 'expired' };
class XHR {
  open(method, url) { this.method = method; this.url = url; }
  setRequestHeader() {}
  send(body) { this.body = body ? JSON.parse(body) : undefined; requests.push(this); }
  respond(response) {
    this.status = 200; this.readyState = 4; this.responseText = JSON.stringify(response); this.onreadystatechange();
  }
}
globalThis.XMLHttpRequest = XHR;
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup() {
  requests = []; adapterCalls = 0; player = 'A'; native = undefined;
  LGameAPI.init({ baseUrl: 'https://example.test/api/v1', appid: '123456', isDevMode: () => false,
    getPlatform: () => 'harmony', platformLogin: async () => {
      adapterCalls++; return native ? native : { success: true, code: `fresh-${adapterCalls}`, gamePlayerId: player };
    } });
  LGameAPI.clearSession();
}
async function login(id = 'A') {
  player = id; const promise = LGameAPI.login(); await tick(); requests.at(-1).respond(ok(id)); await promise;
}
function changed(err) { assert.equal(err.code, 'SESSION_CHANGED'); return true; }
test('Harmony POST字段、并发登录单飞以及清会话', async () => {
  setup(); const one = LGameAPI.login(), two = LGameAPI.login(); await tick();
  assert.equal(adapterCalls, 1); assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'POST');
  assert.deepEqual(requests[0].body, { appid: '123456', platform: 'harmony', code: 'fresh-1', gamePlayerId: 'A' });
  requests[0].respond(ok()); await Promise.all([one, two]);
  assert.equal(LGameAPI.openId, 'A'); assert.equal(LGameAPI.token, 'jwt-A'); assert.equal(LGameAPI.isLoggedIn, true);
  LGameAPI.clearSession(); assert.equal(LGameAPI.openId, ''); assert.equal(LGameAPI.token, ''); assert.equal(LGameAPI.isLoggedIn, false);
});
test('并发402只刷新一次且迟到402复用已刷新的同账户令牌', async () => {
  setup(); await login();
  const a = LGameAPI.saveGameData({ game_key: 'demo', data: 'a' });
  const b = LGameAPI.saveGameData({ game_key: 'demo', data: 'b' });
  const c = LGameAPI.saveGameData({ game_key: 'demo', data: 'c' });
  await tick(); requests[1].respond(expired); requests[2].respond(expired); await tick();
  assert.equal(adapterCalls, 2); assert.equal(requests.length, 5);
  assert.equal(requests[4].body.code, 'fresh-2'); requests[4].respond(ok('A', 'new-A')); await tick();
  requests[3].respond(expired); await tick();
  assert.equal(adapterCalls, 2); assert.equal(requests.length, 8);
  for (const req of requests.slice(5)) { assert.equal(req.body.token, 'new-A'); req.respond({ code: 0, data: { saved: true } }); }
  assert.equal((await a).code, 0); assert.equal((await b).code, 0); assert.equal((await c).code, 0);
});
test('clearSession使迟到native结果和服务器登录结果失效', async () => {
  setup(); let resolveNative; native = new Promise(resolve => { resolveNative = resolve; });
  const first = LGameAPI.login(); const rejection = assert.rejects(first, changed); await tick();
  LGameAPI.clearSession(); resolveNative({ success: true, code: 'late', gamePlayerId: 'A' }); await rejection;
  assert.equal(requests.length, 0);
  native = undefined; const late = LGameAPI.login(); const rejected = assert.rejects(late, changed); await tick();
  const oldRequest = requests.at(-1); LGameAPI.clearSession(); await login('B');
  oldRequest.respond(ok('A')); await rejected;
  assert.equal(LGameAPI.openId, 'B'); assert.equal(LGameAPI.token, 'jwt-B');
});
test('A的存档402不能使用静默登录B的token重试', async () => {
  setup(); await login();
  const save = LGameAPI.saveGameData({ game_key: 'demo', data: 'A存档' }); const rejected = assert.rejects(save, changed);
  await tick(); requests[1].respond(expired); await tick(); player = 'B'; requests[2].respond(ok('B'));
  await rejected; assert.equal(requests.length, 3); assert.equal(LGameAPI.openId, '');
});
test('明确切换账号后丢弃旧业务成功或402，重试期间切换也丢弃', async () => {
  for (const response of [{ code: 0, data: { saved: true } }, expired]) {
    setup(); await login(); const save = LGameAPI.saveGameData({ game_key: 'demo', data: 'A存档' });
    const rejected = assert.rejects(save, changed); await tick(); const old = requests[1];
    LGameAPI.clearSession(); await login('B'); old.respond(response); await rejected; assert.equal(requests.length, 3);
  }
  setup(); await login(); const save = LGameAPI.saveGameData({ game_key: 'demo', data: 'A存档' });
  const rejected = assert.rejects(save, changed); await tick(); requests[1].respond(expired); await tick();
  requests[2].respond(ok('A', 'new-A')); await tick(); const retry = requests[3];
  LGameAPI.clearSession(); await login('B'); retry.respond({ code: 0, data: { saved: true } }); await rejected;
});
test('失败及畸形登录不构成会话；Harmony成功标记与ID必填', async () => {
  for (const data of [{ open_id: '', token: 't' }, { open_id: 'A', token: null }, { open_id: 123, token: 't' }]) {
    setup(); const promise = LGameAPI.login(); const rejected = assert.rejects(promise); await tick(); requests[0].respond({ code: 0, data }); await rejected;
    assert.equal(LGameAPI.isLoggedIn, false);
  }
  for (const result of [{ success: false, code: 'x', gamePlayerId: 'A' }, { success: true, code: '', gamePlayerId: 'A' }, { success: true, code: 'x' }]) {
    setup(); native = Promise.resolve(result); await assert.rejects(LGameAPI.login()); assert.equal(requests.length, 0);
  }
});
test('手动登录换账号失效旧请求，重新init失效旧登录', async () => {
  setup(); await login(); const save = LGameAPI.saveGameData({ game_key: 'demo', data: 'A存档' });
  const rejected = assert.rejects(save, changed); await tick(); const old = requests[1]; await login('B');
  old.respond(expired); await rejected; assert.equal(requests.length, 3); assert.equal(LGameAPI.openId, 'B');
  const pending = LGameAPI.login(); const invalid = assert.rejects(pending, changed); await tick(); const oldLogin = requests.at(-1);
  LGameAPI.init({ baseUrl: 'https://other.test/api/v1', appid: '654321' }); oldLogin.respond(ok('B')); await invalid;
  assert.equal(LGameAPI.isLoggedIn, false);
});

test('402刷新失败后isLoggedIn为false，后续登录可恢复；Harmony禁止dev/login', async () => {
  setup(); await login(); const save = LGameAPI.saveGameData({ game_key: 'demo', data: '存档' });
  await tick(); requests[1].respond(expired); await tick();
  assert.equal(LGameAPI.isLoggedIn, false);
  requests[2].respond({ code: 500, data: null }); assert.equal((await save).code, 402);
  assert.equal(LGameAPI.isLoggedIn, false); await login(); assert.equal(LGameAPI.isLoggedIn, true);
  LGameAPI.init({ baseUrl: 'https://example.test', appid: '123456', isDevMode: () => true, getPlatform: () => 'harmony' });
  const before = requests.length; await assert.rejects(LGameAPI.login()); assert.equal(requests.length, before);
});

test('浏览器开发登录保持POST兼容且不调用native', async () => {
  setup(); LGameAPI.init({ baseUrl: 'https://example.test/api/v1', appid: 'dev-app', devId: 'developer',
    isDevMode: () => true, getPlatform: () => 'web', platformLogin: async () => { throw new Error('不得调用native'); } });
  const promise = LGameAPI.login(); await tick();
  assert.equal(requests[0].method, 'POST'); assert.ok(requests[0].url.endsWith('/dev/login'));
  assert.deepEqual(requests[0].body, { appid: 'dev-app', dev_id: 'developer' }); requests[0].respond(ok('dev-A')); await promise;
  assert.equal(LGameAPI.openId, 'dev-A'); assert.equal(LGameAPI.isLoggedIn, true);
});

test('刷新后的token重试仍返回402时会话保持已知失效', async () => {
  setup(); await login(); const save = LGameAPI.saveGameData({ game_key: 'demo', data: '存档' });
  await tick(); requests[1].respond(expired); await tick(); requests[2].respond(ok('A', 'fresh-token'));
  await tick(); requests[3].respond(expired); assert.equal((await save).code, 402);
  assert.equal(adapterCalls, 2); assert.equal(LGameAPI.isLoggedIn, false);
});

test('直接修改appid或devId立即清会话，旧请求不能跨应用重试', async () => {
  for (const key of ['appid', 'devId']) {
    setup(); await login(); const save = LGameAPI.saveGameData({ game_key: 'demo', data: '旧应用存档' });
    const rejected = assert.rejects(save, changed); await tick(); const old = requests[1];
    LGameAPI[key] = 'new-value'; assert.equal(LGameAPI.isLoggedIn, false); old.respond(expired); await rejected;
    assert.equal(requests.length, 2);
  }
});

test('动态平台或开发模式变化使旧请求与旧会话失效', async () => {
  for (const key of ['platform', 'dev']) {
    setup(); let platform = 'harmony', dev = false;
    LGameAPI.init({ baseUrl: 'https://example.test/api/v1', getPlatform: () => platform, isDevMode: () => dev });
    await login(); const save = LGameAPI.saveGameData({ game_key: 'demo', data: '旧平台存档' });
    const rejected = assert.rejects(save, changed); await tick(); const old = requests[1];
    if (key === 'platform') platform = 'web'; else dev = true;
    assert.equal(LGameAPI.isLoggedIn, false); old.respond(expired); await rejected; assert.equal(requests.length, 2);
  }
});

test('首次native登录pending时改变平台，新平台可立即启动登录', async () => {
  setup(); let platform = 'harmony', resolveOld;
  LGameAPI.init({ baseUrl: 'https://example.test/api/v1', getPlatform: () => platform,
    platformLogin: async () => {
      adapterCalls++;
      if (adapterCalls === 1) return new Promise(resolve => { resolveOld = resolve; });
      return { code: 'new-code' };
    } });
  const old = LGameAPI.login(); const rejected = assert.rejects(old, changed); await tick();
  platform = 'oppo'; const fresh = LGameAPI.login(); await tick();
  assert.equal(adapterCalls, 2); assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'GET'); requests[0].respond(ok('B')); await fresh;
  resolveOld({ success: true, code: 'old-code', gamePlayerId: 'A' }); await rejected;
  assert.equal(LGameAPI.openId, 'B'); assert.equal(requests.length, 1);
});

test('登录增加可选 UID 不改变旧平台身份、令牌或业务调用', async () => {
  setup(); const pending = LGameAPI.login(); await tick();
  const response = ok('A', 'new-token'); response.data.user_id = 'User7K3P9X2DQ6WR';
  requests[0].respond(response); const result = await pending;
  assert.equal(result.data.user_id, 'User7K3P9X2DQ6WR');
  assert.equal(LGameAPI.openId, 'A'); assert.equal(LGameAPI.token, 'new-token');
  const save = LGameAPI.saveGameData({ game_key: 'demo', data: 'fresh-save' }); await tick();
  assert.equal(requests[1].body.token, 'new-token');
  assert.equal(Object.hasOwn(requests[1].body, 'user_id'), false);
  requests[1].respond({ code: 0, data: { saved: true } }); assert.equal((await save).code, 0);
});