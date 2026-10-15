import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { LGameAPI, applyConfig } from '../dist/index.js';

// 替身仅控制网络和时间，队列、会话、HTTP刷新均使用实际SDK实现。
globalThis.window = {};
let requests = [], timers = new Set(), observed = [], player = 'A';
class XHR {
  open(method, url) { this.method = method; this.url = url; }
  setRequestHeader() {}
  send(body) { this.body = body ? JSON.parse(body) : undefined; requests.push(this); }
  respond(response) {
    this.status = 200; this.readyState = 4;
    this.responseText = JSON.stringify(response); this.onreadystatechange();
  }
  fail() { this.onerror(); }
  timeoutNow() { this.ontimeout(); }
}
globalThis.XMLHttpRequest = XHR;
globalThis.setTimeout = (callback, delay) => {
  const timer = { callback, delay, unrefCalls: 0, unref() { this.unrefCalls++; } };
  timers.add(timer); return timer;
};
globalThis.clearTimeout = timer => timers.delete(timer);
const tick = () => new Promise(resolve => setImmediate(resolve));
const response = (data, code = 0, message = '成功') => ({ code, message, data, timestamp: '1791850000000' });
const eventRequests = () => requests.filter(req => req.url.endsWith('/analytics/events'));
function setup(options = {}) {
  LGameAPI.init({ baseUrl: 'https://example.test/api/v1', appid: 'public-app',
    getPlatform: () => 'harmony', isDevMode: () => false,
    platformLogin: async () => ({ success: true, code: 'fresh-code', gamePlayerId: player }),
    onAnalyticsResult: result => observed.push(result), ...options });
  requests = []; observed = []; player = 'A'; timers = new Set();
}
async function login(id = 'A', uid = `User${id.repeat(12)}`) {
  player = id; const pending = LGameAPI.login(); await tick();
  requests.at(-1).respond(response({ open_id: id, token: `jwt-${id}`, ...(uid === undefined ? {} : { user_id: uid }) }));
  await pending;
}
function accept(req, statuses = []) { req.completed = true;
  req.respond(response({ results: req.body.events.map((event, i) => ({ event_id: event.event_id, status: statuses[i] || 'accepted',
    ...(statuses[i] === 'rejected' ? { error: { code: 'PROPERTY_TYPE_INVALID', message: '属性类型不匹配', field: 'properties.score' } } : {}) })) }));
}
async function runTimer() {
  const timer = [...timers][0]; assert.ok(timer, '应有自动上报定时器');
  timers.delete(timer); timer.callback(); await tick(); return timer;
}
const hasCode = code => error => { assert.equal(error.code, code); return true; };
afterEach(() => LGameAPI.clearSession());

test('登录前track进入SDK队列，登录成功后自动发送原事件', async () => {
  setup();
  const properties = { score: 10 };
  const started = Date.now();
  const id = LGameAPI.track('loading_start', properties);
  const captured = Date.now();
  properties.score = 99;
  assert.equal(eventRequests().length, 0);
  assert.equal(timers.size, 0);
  assert.deepEqual(await LGameAPI.flushEvents(), { results: [], pendingCount: 1 });
  await login(); await tick();
  const req = eventRequests()[0];
  assert.ok(req, 'SDK在登录成功后自行发送，无需游戏再调用flush');
  assert.equal(req.body.events[0].event_id, id);
  assert.equal(req.body.events[0].properties.score, 10);
  const occurred = Date.parse(req.body.events[0].occurred_at);
  assert.ok(occurred >= started && occurred <= captured);
  assert.deepEqual(Object.keys(req.body).sort(), ['events', 'token']);
  accept(req); await tick();
  assert.deepEqual(await LGameAPI.flushEvents(), { results: [], pendingCount: 0 });
});

test('旧服务端缺UID允许旧业务，但不能向打点接口发送', async () => {
  setup();
  await login('A', '');
  assert.equal(LGameAPI.isLoggedIn, true);
  assert.throws(() => LGameAPI.track('level_start', {}), hasCode('ANALYTICS_UID_REQUIRED'));
  const saved = LGameAPI.saveGameData({ game_key: 'demo', data: 'legacy' });
  await tick(); requests.at(-1).respond(response({ saved: true })); assert.equal((await saved).code, 0);
});

test('track快照属性并生成UUID和ISO时间，HTTP只自动携带token且默认schema版本为1', async () => {
  setup(); await login();
  const properties = { score: 10, tags: ['开始'], detail: { level: 1 } };
  const id = LGameAPI.track('level_start', properties); properties.score = 99; properties.tags.push('后来'); properties.detail.level = 2;
  assert.match(id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);
  const pending = LGameAPI.flushEvents(); await tick(); const req = eventRequests()[0];
  assert.equal(req.method, 'POST'); assert.equal(req.timeout, 10000);
  assert.deepEqual(Object.keys(req.body).sort(), ['events', 'token']); assert.equal(req.body.token, 'jwt-A');
  assert.deepEqual(req.body.events[0].properties, { score: 10, tags: ['开始'], detail: { level: 1 } });
  assert.equal(req.body.events[0].schema_version, 1); assert.equal(req.body.events[0].event_key, 'level_start');
  assert.equal(req.body.events[0].event_id, id); assert.equal(new Date(req.body.events[0].occurred_at).toISOString(), req.body.events[0].occurred_at);
  accept(req); assert.deepEqual(await pending, { results: [{ event_id: id, status: 'accepted' }], pendingCount: 0 });
  assert.equal(observed[0].results[0].event_id, id);
  assert.deepEqual(await LGameAPI.flushEvents(), { results: [], pendingCount: 0 }); assert.equal(eventRequests().length, 1);
});

test('显式schema版本保留；非法key、版本及非JSON属性同步报错', async () => {
  setup(); await login();
  const cycle = {}; cycle.self = cycle;
  for (const key of ['', '1start', 'two words', 'a'.repeat(65)]) assert.throws(() => LGameAPI.track(key, {}), hasCode('ANALYTICS_PARAM_INVALID'));
  for (const schemaVersion of [0, -1, 1.5, NaN, Infinity, '2']) assert.throws(() => LGameAPI.track('start', {}, { schemaVersion }), hasCode('ANALYTICS_PARAM_INVALID'));
  for (const properties of [null, [], 'text', { value: NaN }, { value: Infinity }, { value: undefined }, { value: () => 1 }, cycle, { value: 1n }, { value: new Date() }]) {
    assert.throws(() => LGameAPI.track('start', properties), hasCode('ANALYTICS_PARAM_INVALID'));
  }
  LGameAPI.track('Level_2', {}, { schemaVersion: 2 }); const pending = LGameAPI.flushEvents(); await tick();
  const req = eventRequests()[0]; assert.equal(req.body.events[0].schema_version, 2); accept(req); await pending;
});

test('8KiB属性限制按UTF8计算并接受边界值', async () => {
  setup(); await login();
  LGameAPI.track('start', { value: 'a'.repeat(8180) });
  assert.throws(() => LGameAPI.track('start', { value: 'a'.repeat(8181) }), hasCode('ANALYTICS_EVENT_TOO_LARGE'));
  assert.throws(() => LGameAPI.track('start', { value: '中'.repeat(3000) }), hasCode('ANALYTICS_EVENT_TOO_LARGE'));
  assert.throws(() => LGameAPI.track('start', { value: '😀'.repeat(2100) }), hasCode('ANALYTICS_EVENT_TOO_LARGE'));
  const pending = LGameAPI.flushEvents(); await tick(); accept(eventRequests()[0]); await pending;
});

test('每批不超过50条且总请求不超过256KiB，flush遍历调用时快照', async () => {
  setup(); await login();
  for (let i = 0; i < 40; i++) LGameAPI.track('start', { value: '中'.repeat(2600), i });
  const pending = LGameAPI.flushEvents(); await tick(); const first = eventRequests()[0];
  assert.ok(first.body.events.length < 40); assert.ok(Buffer.byteLength(JSON.stringify(first.body), 'utf8') <= 256 * 1024);
  accept(first); await tick(); const second = eventRequests()[1]; assert.ok(second);
  assert.ok(second.body.events.length <= 50); assert.ok(Buffer.byteLength(JSON.stringify(second.body), 'utf8') <= 256 * 1024);
  accept(second); const result = await pending; assert.equal(result.results.length, 40); assert.equal(result.pendingCount, 0);
});

test('达到50条立即自动上报；5秒定时上报且Node计时器unref', async () => {
  setup(); await login(); LGameAPI.track('start', {});
  const timer = [...timers][0]; assert.equal(timer.delay, 5000); assert.equal(timer.unrefCalls, 1);
  await runTimer(); assert.equal(eventRequests().length, 1); accept(eventRequests()[0]); await tick();
  assert.equal(observed.length, 1); assert.equal(timers.size, 0);
  for (let i = 0; i < 50; i++) LGameAPI.track('start', { i });
  await tick(); const req = eventRequests()[1]; assert.equal(req.body.events.length, 50); accept(req); await tick();
  assert.equal(observed[1].results.length, 50); assert.equal(timers.size, 0);
});

test('并发flush单飞且发送期间新事件保留到下一次flush', async () => {
  setup(); await login(); const id = LGameAPI.track('start', {});
  const one = LGameAPI.flushEvents(), two = LGameAPI.flushEvents(); await tick(); assert.equal(eventRequests().length, 1);
  const later = LGameAPI.track('finish', {}); accept(eventRequests()[0]);
  assert.deepEqual((await one).results, [{ event_id: id, status: 'accepted' }]); assert.deepEqual(await two, await one);
  assert.equal((await one).pendingCount, 1);
  const next = LGameAPI.flushEvents(); await tick(); assert.equal(eventRequests()[1].body.events[0].event_id, later); accept(eventRequests()[1]); await next;
});

test('部分rejected与duplicate终结且可观察，拒绝回调异常不影响flush', async () => {
  setup({ onAnalyticsResult: value => { observed.push(value); throw new Error('调用方回调错误'); } }); await login();
  const ids = ['start', 'finish', 'score'].map(name => LGameAPI.track(name, {}));
  const pending = LGameAPI.flushEvents(); await tick(); accept(eventRequests()[0], ['accepted', 'duplicate', 'rejected']);
  const result = await pending; assert.deepEqual(result.results.map(item => item.status), ['accepted', 'duplicate', 'rejected']);
  assert.equal(result.results[2].error.code, 'PROPERTY_TYPE_INVALID'); assert.equal(result.results[2].error.field, 'properties.score');
  assert.deepEqual(result.results.map(item => item.event_id), ids); assert.equal(result.pendingCount, 0);
  assert.deepEqual(observed[0], result); await LGameAPI.flushEvents(); assert.equal(eventRequests().length, 1);
});

test('网络与超时失败显式返回且重试保持eventid和occurred_at', async () => {
  for (const action of ['fail', 'timeoutNow']) {
    setup(); await login(); const id = LGameAPI.track('start', { score: 1 });
    const first = LGameAPI.flushEvents(); await tick(); const req = eventRequests()[0]; const snapshot = req.body.events[0]; req[action]();
    const failure = await first; assert.equal(failure.pendingCount, 1); assert.ok(failure.error); assert.equal(failure.results.length, 0);
    const retry = LGameAPI.flushEvents(); await tick(); assert.deepEqual(eventRequests()[1].body.events[0], snapshot);
    accept(eventRequests()[1], ['duplicate']); assert.equal((await retry).results[0].event_id, id);
  }
});

test('503和504保留队列；400/410/411转逐条永久拒绝并停止重传', async () => {
  for (const code of [503, 504, 400, 410, 411]) {
    setup(); await login(); const id = LGameAPI.track('start', {});
    const pending = LGameAPI.flushEvents(); await tick(); eventRequests()[0].respond(response(null, code, `错误${code}`));
    const result = await pending; assert.equal(result.error.code, code);
    if (code >= 500) {
      assert.equal(result.pendingCount, 1); assert.deepEqual(result.results, []);
      const retry = LGameAPI.flushEvents(); await tick(); assert.equal(eventRequests()[1].body.events[0].event_id, id); accept(eventRequests()[1]); await retry;
    } else {
      assert.equal(result.pendingCount, 0); assert.equal(result.results[0].status, 'rejected'); assert.equal(result.results[0].error.code, code);
      await LGameAPI.flushEvents(); assert.equal(eventRequests().length, 1); assert.equal(timers.size, 0);
    }
  }
});

test('自动失败封顶退避，三次失败后仍自行恢复且保留原事件', async () => {
  setup(); await login(); const id=LGameAPI.track('start',{score:2});
  let snapshot;
  for (const delay of [5000,5000,10000,20000,30000,30000,30000]) {
    assert.equal([...timers][0]?.delay,delay,'失败后必须保留有上限的下一次退避');
    await runTimer(); const req=eventRequests().at(-1); snapshot??=req.body.events[0];
    assert.deepEqual(req.body.events[0],snapshot); req.fail(); await tick();
    assert.equal(timers.size,1);
  }
  await runTimer();const req=eventRequests().at(-1);assert.equal(req.body.events[0].event_id,id);
  accept(req,['duplicate']);await tick();assert.equal(observed.at(-1).pendingCount,0);assert.equal(timers.size,0);
  LGameAPI.track('finish',{});assert.equal([...timers][0].delay,5000);
  await runTimer();accept(eventRequests().at(-1));await tick();
});

test('畸形/缺失/重复结果不假装确认，保留未确认事件', async () => {
  for (const data of [null, { results: [] }, { results: [{ event_id: 'unknown', status: 'accepted' }] }]) {
    setup(); await login(); LGameAPI.track('start', {}); const pending = LGameAPI.flushEvents(); await tick();
    eventRequests()[0].respond(response(data)); const result = await pending;
    assert.equal(result.pendingCount, 1); assert.equal(result.error.code, 'ANALYTICS_RESPONSE_INVALID');
  }
  setup(); await login(); const first = LGameAPI.track('start', {}), second = LGameAPI.track('finish', {});
  const pending = LGameAPI.flushEvents(); await tick(); eventRequests()[0].respond(response({ results: [{ event_id: first, status: 'accepted' }] }));
  const result = await pending; assert.equal(result.pendingCount, 1); assert.equal(result.results[0].event_id, first);
  const retry = LGameAPI.flushEvents(); await tick(); assert.equal(eventRequests()[1].body.events[0].event_id, second); accept(eventRequests()[1]); await retry;
});

test('队列最多1000条，溢出同步失败且不删除已经排队事件', async () => {
  setup(); await login(); const ids = [];
  for (let i = 0; i < 1000; i++) ids.push(LGameAPI.track('start', { i }));
  assert.throws(() => LGameAPI.track('start', {}), hasCode('ANALYTICS_QUEUE_FULL'));
  await tick(); accept(eventRequests()[0]); await tick();
  // 自动flush从第50条启动，只提交其快照；剩余事件由下一次flush提交。
  const submitted = observed[0].results.map(item => item.event_id);
  const pending = LGameAPI.flushEvents();
  for (let i = 1; i < 20; i++) { await tick(); const req = eventRequests()[i]; assert.ok(req); assert.ok(req.body.events.length <= 50); accept(req); }
  const result = await pending; submitted.push(...result.results.map(item => item.event_id));
  assert.equal(new Set(submitted).size, 1000); assert.deepEqual(new Set(submitted), new Set(ids));
});

test('队列合计UTF8字节限制1MiB先于1000条触发', async () => {
  setup(); await login(); let count = 0;
  while (true) {
    try { LGameAPI.track('start', { value: '中'.repeat(2600), count }); count++; }
    catch (error) { assert.equal(error.code, 'ANALYTICS_QUEUE_FULL'); break; }
  }
  assert.ok(count > 50 && count < 140); await tick(); eventRequests()[0].fail(); await tick();
  const pending = LGameAPI.flushEvents(); await tick(); eventRequests()[1].fail(); assert.equal((await pending).pendingCount, count);
});

test('clearSession、init、appid/devId变化清旧队列和UID', async () => {
  for (const reset of [
    () => LGameAPI.clearSession(),
    () => LGameAPI.init({ baseUrl: 'https://other.test/api/v1', getPlatform: () => 'harmony', isDevMode: () => false, platformLogin: async () => ({ success: true, code: 'next', gamePlayerId: 'B' }) }),
    () => { LGameAPI.appid = 'new-app'; }, () => { LGameAPI.devId = 'new-developer'; },
  ]) {
    setup(); await login(); LGameAPI.track('start', {}); reset();
    assert.equal(LGameAPI.userId, ''); assert.equal(timers.size, 0); await login('B');
    assert.deepEqual(await LGameAPI.flushEvents(), { results: [], pendingCount: 0 }); assert.equal(eventRequests().length, 0);
  }
});

test('手动login换账号、动态platform/dev/baseUrl变化不跨身份上传', async () => {
  setup(); await login(); LGameAPI.track('start', {}); await login('B'); assert.equal(timers.size, 0);
  await LGameAPI.flushEvents(); assert.equal(eventRequests().length, 0);
  for (const key of ['platform', 'dev', 'baseUrl']) {
    let platform = 'harmony', dev = false;
    setup({ getPlatform: () => platform, isDevMode: () => dev }); await login(); LGameAPI.track('start', {});
    if (key === 'platform') platform = 'oppo'; else if (key === 'dev') dev = true; else applyConfig({ baseUrl: 'https://next.test/api/v1' });
    assert.equal(LGameAPI.isLoggedIn, false); assert.equal(LGameAPI.userId, ''); assert.equal(timers.size, 0);
    if (dev) platform = 'web'; // Harmony的开发登录必须被拒绝，切换到支持开发登录的平台继续检查。
    await login('B'); await LGameAPI.flushEvents(); assert.equal(eventRequests().length, 0);
  }
});

test('旧flush迟到不清新队列且新会话不等待旧单飞任务', async () => {
  setup(); await login(); LGameAPI.track('start', {}); const old = LGameAPI.flushEvents();
  const rejected = assert.rejects(old, hasCode('SESSION_CHANGED')); await tick(); const oldRequest = eventRequests()[0];
  LGameAPI.clearSession(); await login('B'); const freshId = LGameAPI.track('finish', {});
  const fresh = LGameAPI.flushEvents(); await tick(); assert.equal(eventRequests().length, 2);
  accept(oldRequest); await rejected; accept(eventRequests()[1]); const result = await fresh;
  assert.equal(result.results[0].event_id, freshId); assert.equal(result.pendingCount, 0);
});

test('402同账号刷新保持事件和UID，换账号拒绝旧重试', async () => {
  for (const nextPlayer of ['A', 'B']) {
    setup(); await login(); const id = LGameAPI.track('start', {}); const pending = LGameAPI.flushEvents();
    const rejected = nextPlayer === 'B' ? assert.rejects(pending, hasCode('SESSION_CHANGED')) : null;
    await tick(); const old = eventRequests()[0]; old.respond(response(null, 402, '令牌过期')); await tick();
    requests.at(-1).respond(response({ open_id: nextPlayer, token: `new-${nextPlayer}`, user_id: `User${nextPlayer.repeat(12)}` })); await tick();
    if (rejected) { await rejected; assert.equal(eventRequests().length, 1); assert.equal(LGameAPI.userId, ''); }
    else { const retry = eventRequests()[1]; assert.equal(retry.body.token, 'new-A'); assert.equal(retry.body.events[0].event_id, id); accept(retry); assert.equal((await pending).pendingCount, 0); }
  }
});

test('自动上报失败及会话切换不产生未处理异常', async () => {
  const unhandled = []; const listener = error => unhandled.push(error); process.on('unhandledRejection', listener);
  try {
    setup({ onAnalyticsResult: () => { throw new Error('观察者失败'); } }); await login(); LGameAPI.track('start', {});
    await runTimer(); const old = eventRequests()[0]; LGameAPI.clearSession(); accept(old); await tick(); await tick();
    assert.deepEqual(unhandled, []);
  } finally { process.off('unhandledRejection', listener); }
});


test('属性求值期间清会话后不能把旧事件放入新会话队列', async () => {
  setup(); await login();
  const properties = { get score() { LGameAPI.clearSession(); return 1; } };
  assert.throws(() => LGameAPI.track('start', properties), hasCode('SESSION_CHANGED'));
  await login('B'); assert.deepEqual(await LGameAPI.flushEvents(), { results: [], pendingCount: 0 });
  assert.equal(eventRequests().length, 0);
});

test('相同openid刷新成其他UID或缺失UID时清会话并拒绝旧打点', async () => {
  for (const uid of ['UserBBBBBBBBBBBB', undefined]) {
    setup(); await login(); LGameAPI.track('start', {});
    const pending = LGameAPI.flushEvents(); const rejected = assert.rejects(pending, hasCode('SESSION_CHANGED')); await tick();
    eventRequests()[0].respond(response(null, 402, '令牌过期')); await tick();
    requests.at(-1).respond(response({ open_id: 'A', token: 'fresh-A', ...(uid ? { user_id: uid } : {}) }));
    await rejected; assert.equal(eventRequests().length, 1); assert.equal(LGameAPI.userId, ''); assert.equal(timers.size, 0);
  }
});

test('相同openid手动登录成其他UID或缺失UID也清旧队列', async () => {
  for (const uid of ['UserBBBBBBBBBBBB', '']) {
    setup(); await login(); LGameAPI.track('start', {}); await login('A', uid);
    assert.equal(timers.size, 0); assert.equal(LGameAPI.userId, uid);
    assert.deepEqual(await LGameAPI.flushEvents(), { results: [], pendingCount: 0 }); assert.equal(eventRequests().length, 0);
  }
});

test('同openid换UID后旧flush迟到不能确认或清理新UID队列', async () => {
  setup(); await login(); LGameAPI.track('start', {}); const old = LGameAPI.flushEvents();
  const rejected = assert.rejects(old, hasCode('SESSION_CHANGED')); await tick(); const oldRequest = eventRequests()[0];
  await login('A', 'UserBBBBBBBBBBBB'); const freshId = LGameAPI.track('finish', {});
  const fresh = LGameAPI.flushEvents(); await tick(); assert.equal(eventRequests().length, 2);
  accept(oldRequest); await rejected; accept(eventRequests()[1]); const result = await fresh;
  assert.equal(result.results[0].event_id, freshId); assert.equal(result.pendingCount, 0);
});

async function expireAnalyticsDeadline() {
  const timer = [...timers].find(item => item.delay === 10000);
  assert.ok(timer, '整次打点提交必须有包含402刷新的10秒截止时间');
  timers.delete(timer); timer.callback(); await tick();
}

test('402平台登录挂起时10秒截止返回未确认，迟到成功不清队列且可再次flush', async () => {
  let nativeCalls = 0, resolveNative;
  setup({ platformLogin: async () => {
    nativeCalls++;
    if (nativeCalls === 1) return { success: true, code: 'first', gamePlayerId: 'A' };
    return new Promise(resolve => { resolveNative = resolve; });
  } });
  await login(); const id = LGameAPI.track('start', {});
  for (let attempt = 0; attempt < 2; attempt++) {
    const pending = LGameAPI.flushEvents(); await tick(); eventRequests().at(-1).respond(response(null, 402, '令牌过期')); await tick();
    await expireAnalyticsDeadline(); const result = await pending;
    assert.equal(result.error.code, 'ANALYTICS_TIMEOUT'); assert.equal(result.pendingCount, 1); assert.deepEqual(result.results, []);
    assert.equal(nativeCalls, 2, '重复flush应复用仍在途的共享静默登录');
  }
  resolveNative({ success: true, code: 'late-native', gamePlayerId: 'A' }); await tick();
  requests.at(-1).respond(response({ open_id: 'A', user_id: 'UserAAAAAAAAAAAA', token: 'fresh-A' })); await tick();
  for (const req of eventRequests().slice(2)) accept(req); await tick();
  assert.equal(observed.length, 2, '已超时的迟到成功不能生成确认回调');
  const retry = LGameAPI.flushEvents(); await tick(); const req = eventRequests().at(-1);
  assert.equal(req.body.events[0].event_id, id, '迟到成功不能移除待确认事件');
  accept(req, ['duplicate']); const result = await retry; assert.equal(result.pendingCount, 0); assert.equal(result.results[0].event_id, id);
  assert.equal(timers.size, 0);
});

test('402登录HTTP挂起时10秒截止，旧登录迟到不影响新会话且无未处理拒绝', async () => {
  const unhandled = [], listener = error => unhandled.push(error); process.on('unhandledRejection', listener);
  try {
    setup(); await login(); LGameAPI.track('start', {});
    const pending = LGameAPI.flushEvents(); await tick(); eventRequests()[0].respond(response(null, 402, '令牌过期')); await tick();
    const oldLogin = requests.at(-1); assert.ok(oldLogin.url.endsWith('/getOpenId'));
    await expireAnalyticsDeadline(); const timeout = await pending;
    assert.equal(timeout.error.code, 'ANALYTICS_TIMEOUT'); assert.equal(timeout.pendingCount, 1);
    LGameAPI.clearSession(); await login('B'); const freshId = LGameAPI.track('finish', {});
    const fresh = LGameAPI.flushEvents(); await tick(); const newRequest = eventRequests().at(-1);
    oldLogin.respond(response({ open_id: 'A', user_id: 'UserAAAAAAAAAAAA', token: 'late-A' })); await tick(); await tick();
    assert.equal(LGameAPI.userId, 'UserBBBBBBBBBBBB'); assert.equal(LGameAPI.token, 'jwt-B'); assert.equal(eventRequests().length, 2);
    accept(newRequest); assert.deepEqual((await fresh).results, [{ event_id: freshId, status: 'accepted' }]);
    await tick(); assert.deepEqual(unhandled, []); assert.equal(timers.size, 0);
  } finally { process.off('unhandledRejection', listener); }
});

test('自动402刷新挂起仍退避重试，截止计时器及时清理', async () => {
  let nativeCalls = 0;
  setup({ platformLogin: async () => {
    nativeCalls++; if (nativeCalls === 1) return { success: true, code: 'first', gamePlayerId: 'A' };
    return new Promise(() => {});
  } });
  await login(); LGameAPI.track('start', {});
  for (let attempt = 0; attempt < 3; attempt++) {
    await runTimer(); eventRequests().at(-1).respond(response(null, 402, '令牌过期')); await tick(); await expireAnalyticsDeadline();
  }
  assert.equal(eventRequests().length, 3); assert.equal(nativeCalls, 2); assert.equal(observed.length, 3);
  assert.ok(observed.every(item => item.error.code === 'ANALYTICS_TIMEOUT' && item.pendingCount === 1));
  assert.equal(timers.size, 1); assert.equal([...timers][0].delay,20000);
});

test('登录失败保留登录前队列，后续成功才自动提交', async () => {
  setup(); const id = LGameAPI.track('loading_start', {});
  const failed = LGameAPI.login(); await tick();
  requests.at(-1).respond(response(null, 500, '登录失败')); await failed; await tick();
  assert.equal(eventRequests().length, 0);
  assert.equal((await LGameAPI.flushEvents()).pendingCount, 1);
  await login(); await tick();
  assert.equal(eventRequests()[0].body.events[0].event_id, id);
  accept(eventRequests()[0]); await tick();
});

test('登录进行中产生的事件仍由SDK暂存，登录完成一起发送', async () => {
  setup(); const pending = LGameAPI.login(); await tick();
  const request = requests.at(-1);
  const id = LGameAPI.track('loading_complete', { duration: 1.5 });
  assert.equal(eventRequests().length, 0);
  request.respond(response({ open_id: 'A', user_id: 'UserAAAAAAAAAAAA', token: 'jwt-A' }));
  await pending; await tick();
  assert.equal(eventRequests()[0].body.events[0].event_id, id);
  accept(eventRequests()[0]); await tick();
});

test('登录前达到批次阈值不会联网，首次登录后分批排空', async () => {
  setup(); const ids = [];
  for (let i = 0; i < 125; i++) ids.push(LGameAPI.track('loading', { i }));
  assert.equal(eventRequests().length, 0); assert.equal(timers.size, 0);
  await login(); await tick();
  for (let i = 0; i < 3; i++) { const req = eventRequests()[i]; assert.ok(req); assert.ok(req.body.events.length <= 50); accept(req); await tick(); }
  assert.deepEqual(observed[0].results.map(row => row.event_id), ids);
  assert.equal(observed[0].pendingCount, 0);
});

test('SDK初始化或会话清空移除旧的登录前事件', async () => {
  for (const reset of [() => LGameAPI.clearSession(), () => LGameAPI.appid = 'next-app', () => LGameAPI.devId = 'next-dev']) {
    setup(); const old = LGameAPI.track('old', {}); reset();
    const fresh = LGameAPI.track('fresh', {});
    await login('B'); await tick();
    assert.deepEqual(eventRequests()[0].body.events.map(row => row.event_id), [fresh]);
    assert.notEqual(fresh, old); accept(eventRequests()[0]); await tick();
  }
});

test('登录前适配平台变化由SDK清掉旧来源队列', async () => {
  setup(); const old = LGameAPI.track('old', {});
  applyConfig({ getPlatform: () => 'wechat' });
  const fresh = LGameAPI.track('fresh', {});
  await login('B'); await tick();
  assert.deepEqual(eventRequests()[0].body.events.map(row => row.event_id), [fresh]);
  assert.notEqual(old, fresh); accept(eventRequests()[0]); await tick();
});

function recoveryRuntime() {
  const shown=new Set(),network=new Set();
  return {shown,network,onShow(fn){shown.add(fn)},offShow(fn){shown.delete(fn)},
    onNetworkStatusChange(fn){network.add(fn)},offNetworkStatusChange(fn){network.delete(fn)},
    show(){for(const fn of [...shown])fn()},connected(value){for(const fn of [...network])fn({isConnected:value})}};
}
function setupRecovery(runtime){window.wx=runtime;setup({getPlatform:()=> 'wechat'});}
async function failAutomatically(count=3){for(let i=0;i<count;i++){await runTimer();eventRequests().at(-1).fail();await tick();}}

test('失败期间达到50条不能绕过退避',async()=>{
  setup();await login();LGameAPI.track('start',{});await failAutomatically();const count=eventRequests().length;
  for(let i=0;i<60;i++)LGameAPI.track('later',{i});await tick();
  assert.equal(eventRequests().length,count);assert.equal(timers.size,1);assert.equal([...timers][0].delay,20000);
  await runTimer();const first=eventRequests().at(-1);assert.equal(first.body.events.length,50);accept(first);await tick();accept(eventRequests().at(-1));await tick();assert.equal(observed.at(-1).pendingCount,0);
});

test('回前台由SDK恢复旧队列，不重新login、track或手动flush',async()=>{
  const runtime=recoveryRuntime();setupRecovery(runtime);await login();const id=LGameAPI.track('close_ui',{ui_name:'SettingUI'});
  await failAutomatically();const original=eventRequests()[0].body.events[0];const count=eventRequests().length;
  assert.equal(runtime.shown.size,1);runtime.show();await tick();assert.equal(eventRequests().length,count+1);
  assert.deepEqual(eventRequests().at(-1).body.events[0],original);assert.equal(eventRequests().at(-1).body.events[0].event_id,id);
  accept(eventRequests().at(-1));await tick();assert.equal(observed.at(-1).pendingCount,0);assert.equal(timers.size,0);
});

test('恢复联网由SDK立即补发，断网通知不提前发请求',async()=>{
  const runtime=recoveryRuntime();setupRecovery(runtime);await login();LGameAPI.track('open_ui',{});await failAutomatically();
  const count=eventRequests().length;assert.equal(runtime.network.size,1);runtime.connected(false);await tick();assert.equal(eventRequests().length,count);
  runtime.connected(true);await tick();assert.equal(eventRequests().length,count+1);accept(eventRequests().at(-1));await tick();assert.equal(timers.size,0);
});

test('恢复信号与在途请求单飞，失败结束后执行一次恢复补发',async()=>{
  const runtime=recoveryRuntime();setupRecovery(runtime);await login();const id=LGameAPI.track('start',{});await runTimer();
  runtime.show();runtime.connected(true);await tick();assert.equal(eventRequests().length,1);
  eventRequests()[0].fail();await tick();assert.equal(eventRequests().length,2);assert.equal(eventRequests()[1].body.events[0].event_id,id);
  accept(eventRequests()[1]);await tick();assert.equal(timers.size,0);
});

test('重复init只保留当前监听，旧恢复回调不能发送新来源队列',async()=>{
  const runtime=recoveryRuntime();setupRecovery(runtime);await login();LGameAPI.track('old',{});
  const oldCallback=[...runtime.shown][0];assert.equal(typeof oldCallback,'function');
  setupRecovery(runtime);await login('B');const id=LGameAPI.track('new',{});
  assert.equal(runtime.shown.size,1);assert.equal(runtime.network.size,1);oldCallback();await tick();assert.equal(eventRequests().length,0);
  runtime.show();await tick();assert.deepEqual(eventRequests()[0].body.events.map(e=>e.event_id),[id]);assert.equal(eventRequests()[0].body.token,'jwt-B');accept(eventRequests()[0]);await tick();
});

test('clearSession后恢复通知不发旧事件，重新登录仍保留恢复能力',async()=>{
  const runtime=recoveryRuntime();setupRecovery(runtime);await login();LGameAPI.track('old',{});LGameAPI.clearSession();
  runtime.show();runtime.connected(true);await tick();assert.equal(eventRequests().length,0);
  await login('B');const id=LGameAPI.track('new',{});runtime.show();await tick();assert.equal(eventRequests()[0].body.events[0].event_id,id);assert.equal(eventRequests()[0].body.token,'jwt-B');accept(eventRequests()[0]);await tick();
});


test('手动失败后新事件达到50条仍遵守自动退避',async()=>{
  setup();await login();LGameAPI.track('start',{});const pending=LGameAPI.flushEvents();await tick();eventRequests()[0].fail();await pending;await tick();
  for(let i=0;i<55;i++)LGameAPI.track('later',{i});await tick();assert.equal(eventRequests().length,1);assert.equal(timers.size,1);
  await runTimer();accept(eventRequests().at(-1));await tick();accept(eventRequests().at(-1));await tick();assert.equal(observed.at(-1).pendingCount,0);
});

test('平台监听不可用或抛错不影响初始化，仍使用退避恢复',async()=>{
  const runtime=recoveryRuntime();runtime.onShow=()=>{throw new Error('平台不支持')};runtime.onNetworkStatusChange=undefined;
  setupRecovery(runtime);await login();LGameAPI.track('start',{});await failAutomatically();assert.equal([...timers][0].delay,20000);
  await runTimer();accept(eventRequests().at(-1));await tick();assert.equal(timers.size,0);
});

test('动态平台切换后旧平台恢复通知不能唤醒新来源',async()=>{
  const runtime=recoveryRuntime();window.wx=runtime;let platform='wechat';setup({getPlatform:()=>platform});await login();LGameAPI.track('old',{});
  platform='ali';await login('B');const id=LGameAPI.track('new',{});runtime.show();runtime.connected(true);await tick();assert.equal(eventRequests().length,0);
  await runTimer();assert.equal(eventRequests()[0].body.events[0].event_id,id);assert.equal(eventRequests()[0].body.token,'jwt-B');accept(eventRequests()[0]);await tick();
});
