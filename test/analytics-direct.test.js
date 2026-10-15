import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { LGameAPI, applyConfig } from '../dist/index.js';

// 网络和时间由测试控制，其余使用真实SDK队列、登录和会话实现。
globalThis.window = {};
let requests = [], timers = new Set(), observed = [];
const originalNow = Date.now;
class XHR {
  headers = {};
  open(method, url) { this.method = method; this.url = url; }
  setRequestHeader(key, value) { this.headers[key.toLowerCase()] = value; }
  send(body) { this.body = body ? JSON.parse(body) : undefined; requests.push(this); }
  respond(body, status = 200) {
    this.status = status; this.readyState = 4; this.responseText = JSON.stringify(body); this.onreadystatechange();
  }
  fail() { this.onerror(); }
}
globalThis.XMLHttpRequest = XHR;
globalThis.setTimeout = (callback, delay) => { const timer = { callback, delay, unref() {} }; timers.add(timer); return timer; };
globalThis.clearTimeout = timer => timers.delete(timer);
const tick = () => new Promise(resolve => setImmediate(resolve));
const response = (data, code = 0, message = '成功') => ({ code, message, data, timestamp: '1791850000000' });
const credentialRequests = () => requests.filter(req => req.url.endsWith('/analytics/credential'));
const directRequests = () => requests.filter(req => req.url.endsWith('/v1/events'));
const legacyRequests = () => requests.filter(req => req.url.endsWith('/analytics/events'));
function setup(options = {}) {
  Date.now = originalNow;
  LGameAPI.init({ baseUrl: 'https://game.example.test/api/v1/', analyticsBaseUrl: 'https://collect.example.test/', appid: 'public-app',
    getPlatform: () => 'harmony', isDevMode: () => false,
    platformLogin: async () => ({ success: true, code: 'fresh-code', gamePlayerId: 'A' }),
    onAnalyticsResult: result => observed.push(result), ...options });
  requests = []; timers = new Set(); observed = [];
}
async function login(id = 'A') {
  const pending = LGameAPI.login(); await tick();
  requests.at(-1).respond(response({ open_id: id, user_id: `User${id.repeat(12)}`, token: `jwt-${id}` })); await pending;
}
function credential(req = credentialRequests().at(-1), token = 'collect-token', expiresAt = Math.floor(Date.now() / 1000) + 900) {
  assert.ok(req, '应向游戏API申请独立采集凭据'); req.respond(response({ token, expires_at: expiresAt }));
}
function accept(req = directRequests().at(-1), status = 200) {
  assert.ok(req, '应向独立采集服务直传');
  req.respond(response({ results: req.body.events.map(event => ({ event_id: event.event_id, status: 'accepted' })) }), status);
}
async function start() { LGameAPI.track('level_start', { score: 1 }); const pending = LGameAPI.flushEvents(); await tick(); return { pending }; }
async function deadline() { const timer = [...timers].find(timer => timer.delay === 10000); assert.ok(timer); timers.delete(timer); timer.callback(); await tick(); }
afterEach(() => { Date.now = originalNow; LGameAPI.clearSession(); });

test('直传只向游戏API发送玩家JWT，采集请求只含独立Bearer和原事件', async () => {
  setup(); const id = LGameAPI.track('loading_start', {}); await login(); await tick();
  assert.equal(credentialRequests().length, 1); const req = credentialRequests()[0];
  assert.equal(req.url, 'https://game.example.test/api/v1/analytics/credential'); assert.equal(req.method, 'POST');
  assert.deepEqual(req.body, { token: 'jwt-A' }); assert.equal(req.headers.authorization, undefined);
  credential(req); await tick(); const direct = directRequests()[0];
  assert.equal(direct.url, 'https://collect.example.test/v1/events'); assert.equal(direct.method, 'POST');
  assert.equal(direct.headers.authorization, 'Bearer collect-token'); assert.deepEqual(Object.keys(direct.body), ['events']);
  assert.equal(direct.body.events[0].event_id, id); assert.ok(!JSON.stringify(direct.body).includes('jwt-A'));
  assert.equal(legacyRequests().length, 0); accept(direct); await tick(); assert.equal((await LGameAPI.flushEvents()).pendingCount, 0);
});

test('并发flush只申请一次凭据，后续批次缓存凭据并提前60秒更新', async () => {
  setup(); await login(); let now = originalNow(); Date.now = () => now;
  const first = await start(); const concurrent = LGameAPI.flushEvents(); assert.equal(credentialRequests().length, 1);
  credential(undefined, 'first', Math.floor(now / 1000) + 900); await tick(); accept(); await first.pending; await concurrent;
  const second = await start(); assert.equal(credentialRequests().length, 1); assert.equal(directRequests().at(-1).headers.authorization, 'Bearer first'); accept(); await second.pending;
  now += 841000; const third = await start(); assert.equal(credentialRequests().length, 2); credential(undefined, 'renewed'); await tick();
  assert.equal(directRequests().at(-1).headers.authorization, 'Bearer renewed'); accept(); await third.pending;
});

test('采集HTTP401仅刷新一次并保留事件ID与发生时间', async () => {
  setup(); await login(); const { pending } = await start(); credential(); await tick();
  const old = directRequests()[0], event = old.body.events[0]; old.respond(response(null, 'CREDENTIAL_EXPIRED', '凭据到期'), 401); await tick();
  assert.equal(credentialRequests().length, 2); credential(undefined, 'fresh-collect'); await tick();
  const retry = directRequests()[1]; assert.deepEqual(retry.body.events[0], event); assert.equal(retry.headers.authorization, 'Bearer fresh-collect');
  retry.respond(response(null, 'CREDENTIAL_INVALID', '凭据无效'), 401); const result = await pending;
  assert.equal(credentialRequests().length, 2); assert.equal(directRequests().length, 2); assert.equal(result.pendingCount, 1); assert.equal(result.error.code, 'CREDENTIAL_INVALID');
  assert.equal(legacyRequests().length, 0);
});

test('401依据HTTP状态刷新，200同名正文错误不能触发刷新', async () => {
  for (const status of [200, 401]) {
    setup(); await login(); const { pending } = await start(); credential(); await tick();
    directRequests()[0].respond(response(null, 'CREDENTIAL_INVALID', '凭据错误'), status); await tick();
    assert.equal(credentialRequests().length, status === 401 ? 2 : 1);
    if (status === 401) { credential(); await tick(); accept(); }
    const result = await pending; assert.equal(result.pendingCount, status === 401 ? 0 : 1);
  }
});

test('非2xx即使正文code0也不能确认，网络失败绝不跨主机回退', async () => {
  for (const failure of ['http', 'network']) {
    setup(); await login(); const { pending } = await start(); credential(); await tick();
    const req = directRequests()[0]; if (failure === 'http') accept(req, 503); else req.fail();
    const result = await pending; assert.equal(result.pendingCount, 1); assert.deepEqual(result.results, []); assert.ok(result.error);
    assert.equal(legacyRequests().length, 0);
  }
});

test('凭据接口失败或返回非法/过期凭据保留队列，不发送采集请求', async () => {
  for (const body of [response(null, 503, '稍后重试'), response({ token: '', expires_at: 1 }), response({ token: 'expired', expires_at: 1 }), response({ token: 'bad', expires_at: 'later' })]) {
    setup(); await login(); const { pending } = await start(); assert.ok(credentialRequests()[0]); credentialRequests()[0].respond(body);
    const result = await pending; assert.equal(result.pendingCount, 1); assert.ok(result.error); assert.equal(directRequests().length, 0); assert.equal(legacyRequests().length, 0);
  }
});

test('凭据HTTP402沿用玩家静默登录，重试仍只向游戏API发送新玩家JWT', async () => {
  setup(); await login(); const { pending } = await start(); assert.ok(credentialRequests()[0]);
  credentialRequests()[0].respond(response(null, 402, '玩家令牌到期')); await tick();
  const loginReq = requests.at(-1); assert.ok(loginReq.url.endsWith('/getOpenId'));
  loginReq.respond(response({ open_id: 'A', user_id: 'UserAAAAAAAAAAAA', token: 'jwt-fresh' })); await tick();
  assert.equal(credentialRequests().length, 2); assert.deepEqual(credentialRequests()[1].body, { token: 'jwt-fresh' });
  credential(); await tick(); assert.equal(directRequests()[0].headers.authorization, 'Bearer collect-token'); accept(); assert.equal((await pending).pendingCount, 0);
});

test('10秒截止覆盖凭据，迟到凭据不再发事件且下一flush复用在途申请', async () => {
  setup(); await login(); const first = await start(); assert.equal(credentialRequests().length, 1); await deadline();
  assert.equal((await first.pending).error.code, 'ANALYTICS_TIMEOUT');
  const next = LGameAPI.flushEvents(); await tick(); assert.equal(credentialRequests().length, 1);
  credential(); await tick(); assert.equal(directRequests().length, 1); accept(); assert.equal((await next).pendingCount, 0);
});

test('10秒截止后迟到401不能再申请凭据，事件保留待重试', async () => {
  setup(); await login(); const { pending } = await start(); credential(); await tick(); const old = directRequests()[0];
  await deadline(); const result = await pending; assert.equal(result.error.code, 'ANALYTICS_TIMEOUT'); assert.equal(result.pendingCount, 1);
  old.respond(response(null, 'CREDENTIAL_EXPIRED'), 401); await tick(); assert.equal(credentialRequests().length, 1);
});

test('clearSession及换appid使旧凭据回调失效，新身份不等待旧凭据', async () => {
  for (const reset of [() => LGameAPI.clearSession(), () => { LGameAPI.appid = 'next-app'; }]) {
    setup(); await login(); const first = await start(); const rejected = assert.rejects(first.pending, error => error.code === 'SESSION_CHANGED');
    const old = credentialRequests()[0]; assert.ok(old); reset(); await login('B'); await rejected;
    const fresh = await start(); assert.equal(credentialRequests().length, 2); credential(undefined, 'token-B'); await tick(); accept(); await fresh.pending;
    credential(old, 'late-A'); await tick(); assert.equal(directRequests().length, 1);
    const next = await start(); assert.equal(directRequests().at(-1).headers.authorization, 'Bearer token-B'); accept(); await next.pending;
  }
});

test('动态采集地址变化清旧队列和凭据，重新init省略配置回到原通道', async () => {
  setup(); await login(); const old = await start(); credential(); await tick(); accept(); await old.pending;
  LGameAPI.track('old_pending', {}); applyConfig({ baseUrl: 'https://game.example.test/api/v1/', analyticsBaseUrl: 'https://next-collect.example.test/' });
  assert.equal(LGameAPI.isLoggedIn, false); assert.equal((await LGameAPI.flushEvents()).pendingCount, 0);
  await login('B'); const fresh = await start(); assert.equal(credentialRequests().length, 2); credential(undefined, 'next'); await tick();
  assert.equal(directRequests().at(-1).url, 'https://next-collect.example.test/v1/events'); accept(); await fresh.pending;
  setup({ analyticsBaseUrl: undefined }); await login(); const legacy = await start(); assert.equal(credentialRequests().length, 0); assert.equal(legacyRequests().length, 1);
  accept(legacyRequests()[0]); await legacy.pending;
});

test('采集地址默认仅HTTPS，HTTP只接受本地回环地址且无需URL全局对象', async () => {
  const URLConstructor = globalThis.URL;
  try {
    globalThis.URL = undefined;
    for (const analyticsBaseUrl of ['https://collect.example.test', 'http://localhost:8080/', 'http://127.0.0.1:8080', 'http://[::1]:8080/']) {
      assert.doesNotThrow(() => setup({ analyticsBaseUrl }));
    }
    for (const analyticsBaseUrl of ['http://collect.example.test', '//collect.example.test', 'https://user:pass@collect.example.test/', 'https://collect.example.test/?token=x', 'https://collect.example.test/#x', 'http://localhost.evil.test/', 'https://collect.example.test\\evil', ' https://collect.example.test']) {
      assert.throws(() => setup({ analyticsBaseUrl }), /analyticsBaseUrl/);
    }
  } finally { globalThis.URL = URLConstructor; }
});

test('直传应用或来源停用及非法批次保留错误码并终结整批', async () => {
  for (const code of ['APP_NOT_REGISTERED', 'APP_DISABLED', 'BINDING_DISABLED', 'INVALID_BATCH', 'INVALID_IDENTITY', 'INVALID_INPUT']) {
    setup(); await login(); const { pending } = await start(); credential(); await tick();
    directRequests()[0].respond(response(null, code, '配置或批次不可用'), code === 'INVALID_BATCH' ? 400 : 403);
    const result = await pending; assert.equal(result.error.code, code); assert.equal(result.pendingCount, 0);
    assert.equal(result.results[0].status, 'rejected'); assert.equal(result.results[0].error.code, code); assert.equal(credentialRequests().length, 1);
  }
});


test('动态地址在凭据申请中改变后旧回调不能向任何采集主机发事件', async () => {
  setup(); await login(); const old = await start(); const rejected = assert.rejects(old.pending, error => error.code === 'SESSION_CHANGED');
  const oldCredential = credentialRequests()[0]; assert.ok(oldCredential);
  applyConfig({ baseUrl: 'https://new-game.example.test/api/v1/', analyticsBaseUrl: 'https://new-collect.example.test/' });
  assert.equal(LGameAPI.isLoggedIn, false); await rejected; await login('B'); const next = await start();
  credential(oldCredential, 'old-token'); await tick(); assert.equal(directRequests().length, 0);
  credential(undefined, 'new-token'); await tick(); assert.equal(directRequests()[0].url, 'https://new-collect.example.test/v1/events');
  accept(); assert.equal((await next.pending).pendingCount, 0);
});

test('显式登录换身份或相同openid换UID后不能复用原采集凭据', async () => {
  for (const sameOpenId of [false, true]) {
    setup(); await login(); const first = await start(); credential(); await tick(); accept(); await first.pending;
    const pendingLogin = LGameAPI.login(); await tick(); requests.at(-1).respond(response({ open_id: sameOpenId ? 'A' : 'B', user_id: 'UserBBBBBBBBBBBB', token: 'jwt-B' })); await pendingLogin;
    const next = await start(); assert.equal(credentialRequests().length, 2); assert.equal(credentialRequests()[1].body.token, 'jwt-B');
    credential(undefined, 'token-B'); await tick(); assert.equal(directRequests().at(-1).headers.authorization, 'Bearer token-B'); accept(); await next.pending;
  }
});

test('采集服务内部错误不触发玩家登录或换凭据，保留原事件', async () => {
  for (const code of ['COLLECTOR_BUSY', 'DATABASE_ERROR', 'NOT_FOUND']) {
    setup(); await login(); const { pending } = await start(); credential(); await tick(); const event = directRequests()[0].body.events[0];
    directRequests()[0].respond(response(null, code, '暂时失败'), 503); const result = await pending;
    assert.equal(result.error.code, code); assert.equal(result.pendingCount, 1); assert.equal(credentialRequests().length, 1);
    assert.equal(requests.filter(req => req.url.endsWith('/getOpenId')).length, 1);
    const retry = LGameAPI.flushEvents(); await tick(); assert.deepEqual(directRequests().at(-1).body.events[0], event); accept(); await retry;
  }
});
