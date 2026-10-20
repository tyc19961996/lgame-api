import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { LGameAPI } from '../dist/index.js';
import { readFileSync } from 'node:fs';
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version;
globalThis.window = {};
let cap = 1, fail = false, identity = 'A', wire = [], probes = 0, capabilityRequests = [], rejectCredentialOnce = false, omitUserId = false;
const response = data => ({ code: 0, data, message: '成功', timestamp: String(Date.now()) });
class XHR {
  headers = {};
  open(method, url) { this.method = method; this.url = url; }
  setRequestHeader(key, value) { this.headers[key.toLowerCase()] = value; }
  send(body) {
    const data = body ? JSON.parse(body) : {};
    queueMicrotask(() => {
      if (this.url.endsWith('/v1/capabilities')) {
        probes++; capabilityRequests.push(this);
        assert.equal(this.method, 'GET'); assert.deepEqual(this.headers, {}); assert.equal(body, undefined); assert.equal(this.timeout, 1500);
        if (cap === 'hold') return;
        if (cap === 'timeout') { this.ontimeout(); return; }
        if (cap === 'network') { this.onerror(); return; }
        if (cap === 'invalid') { this.respond(response({ event_context_version: '1' })); return; }
        this.respond(cap === 1 ? response({ event_context_version: 1 }) : {}, cap === 1 ? 200 : 404);
      }
      else if (this.url.includes('/getOpenId') || this.url.endsWith('/dev/login')) this.respond(response({ open_id: identity, user_id: omitUserId ? undefined : 'User' + identity, token: 'jwt-' + identity }));
      else if (this.url.endsWith('/analytics/credential')) this.respond(response({ token: 'collector', expires_at: Math.floor(Date.now()/1000) + 900 }));
      else if (this.url.endsWith('/events')) {
        wire.push(data.events);
        if (rejectCredentialOnce) { rejectCredentialOnce=false; this.respond(response(null), 401); }
        else if (fail) this.onerror();
        else this.respond(response({ results: data.events.map(e => ({ event_id: e.event_id, status: 'accepted' })) }));
      } else throw Error(this.url);
    });
  }
  respond(data, status = 200) { this.readyState = 4; this.status = status; this.responseText = JSON.stringify(data); this.onreadystatechange(); }
}
globalThis.XMLHttpRequest = XHR;
const options = () => ({ baseUrl: 'https://game.example.test/api/v1/', analyticsBaseUrl: 'https://collect.example.test/', appid: 'app', getPlatform: () => 'wechat', isDevMode: () => false, platformLogin: async () => ({ code: 'new' }), app_version: '2.3', os_name: 'ANDROID', device_model: '测试型号' });
async function setup(extra = {}) { LGameAPI.clearSession(); cap=1; fail=false; identity='A'; wire=[]; probes=0; capabilityRequests=[]; rejectCredentialOnce=false; omitUserId=false; LGameAPI.init({ ...options(), ...extra }); await LGameAPI.login(); }
async function track(properties = {}) { LGameAPI.track('start', properties); await LGameAPI.flushEvents(); return wire.at(-1)[0]; }
afterEach(() => LGameAPI.clearSession());
test('初始化三字段自动快照、SDK版本与北京时间，模拟玩家固定false且保留旧业务属性', async () => {
  await setup(); const event = await track({ is_mock: true, app_version: '旧业务值' });
  assert.deepEqual(event.context, { app_version: '2.3', sdk_version: version, os_name: 'ANDROID', device_model: '测试型号', is_mock: false, client_event_at: new Date(Date.parse(event.occurred_at)+8*3600000).toISOString().slice(0,19).replaceAll('-', '/').replace('T',' ') });
  assert.deepEqual(event.properties, { is_mock: true, app_version: '旧业务值' });
  assert.ok(event.session_id); assert.equal(event.event_seq, 1); assert.ok(event.session_started_at); assert.equal(probes, 1);
});
test('登录前事件与登录后事件保持同会话序号，缺少初始化参数为null', async () => {
  await setup({ app_version: undefined, os_name: undefined, device_model: undefined }); LGameAPI.clearSession(); wire=[];
  LGameAPI.track('before'); await LGameAPI.login(); await LGameAPI.flushEvents();
  const first=wire[0][0], second=await track(); assert.equal(first.session_id,second.session_id); assert.equal(first.event_seq,1); assert.equal(second.event_seq,2);
  assert.equal(first.context.app_version,null); assert.equal(first.context.os_name,null); assert.equal(first.context.device_model,null);
});
test('同来源重复初始化不重置操作会话，换号和显式清理才产生新会话', async () => {
  await setup(); const first=await track(); LGameAPI.init(options()); await LGameAPI.login(); const second=await track();
  assert.equal(second.session_id,first.session_id); assert.equal(second.event_seq,2);
  identity='B'; await LGameAPI.login(); const third=await track(); assert.notEqual(third.session_id,second.session_id); assert.equal(third.event_seq,1);
});
test('失败重试保留同一元数据与协议，能力后来变化不改旧事件载荷', async () => {
  await setup(); fail=true; const first=await track(); cap=0; fail=false; await LGameAPI.flushEvents(); assert.deepEqual(wire.at(-1)[0],first);
});
test('旧采集端和旧游戏转发只发送原五字段，旧协议重试不升级载荷', async () => {
  await setup(); cap=0; fail=true; const first=await track(); assert.deepEqual(Object.keys(first),['event_id','event_key','schema_version','occurred_at','properties']);
  cap=1; fail=false; await LGameAPI.flushEvents(); assert.deepEqual(wire.at(-1)[0],first);
  await setup({ analyticsBaseUrl: '' }); const legacy=await track(); assert.equal(legacy.context,undefined); assert.equal(probes,0);
});


test('三字段拒绝非字符串、超长和控制字符，空白归一null且版本模块与包一致', async () => {
  const { SDK_VERSION } = await import('../dist/version.js'); assert.equal(SDK_VERSION, version);
  for (const field of ['app_version', 'os_name', 'device_model']) {
    for (const invalid of [null, 123, true, {}, 'x'.repeat(129), 'a\n', 'a\u0000', 'a\u007f', 'a\u0085']) {
      assert.throws(() => LGameAPI.init({ ...options(), [field]: invalid }), new RegExp(field));
    }
  }
  await setup({ app_version: '  ', os_name: ' Android ', device_model: '' });
  const event=await track(); assert.equal(event.context.app_version,null); assert.equal(event.context.os_name,'Android'); assert.equal(event.context.device_model,null);
  await setup({ app_version: 'x'.repeat(128) }); assert.equal((await track()).context.app_version.length,128);
});

test('能力网络错误或超时只降级本次新事件，恢复后升级不改变旧事件wire', async () => {
  for (const mode of ['network','timeout','invalid']) {
    await setup(); cap=mode; fail=true; const first=await track(); assert.equal(first.context,undefined);
    cap=1; fail=false; LGameAPI.track('after_recovery'); await LGameAPI.flushEvents();
    const events=wire.at(-1); assert.deepEqual(events[0],first); assert.ok(events[1].context); assert.equal(probes,2);
  }
});

test('同毫秒事件序号递增，重复init更新后续快照且沿用操作会话', async () => {
  await setup(); const RealDate=globalThis.Date, fixed=Date.now();
  globalThis.Date=class extends RealDate { constructor(value) { super(arguments.length ? value : fixed); } static now() { return fixed; } };
  let first, second;
  try { first=await track(); second=await track(); } finally { globalThis.Date=RealDate; }
  assert.equal(first.occurred_at,second.occurred_at); assert.equal(first.event_seq,1); assert.equal(second.event_seq,2); assert.equal(first.session_id,second.session_id);
  assert.match(first.session_id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/); assert.match(first.session_started_at,/^\d{4}-\d{2}-\d{2}T.*\.\d{3}Z$/);
  LGameAPI.init({ ...options(), app_version:'3.0', os_name: 'iOS' }); await LGameAPI.login(); const third=await track();
  assert.equal(third.context.app_version,'3.0'); assert.equal(third.context.os_name,'iOS'); assert.equal(first.context.app_version,'2.3'); assert.equal(third.session_id,first.session_id); assert.equal(third.event_seq,3);
});

test('扩展协议HTTP401刷新采集凭据保持整条wire及操作会话', async () => {
  await setup(); rejectCredentialOnce=true; const event=await track(); assert.equal(wire.length,2); assert.deepEqual(wire[0][0],wire[1][0]); assert.ok(event.context); assert.equal(probes,1);
  const next=await track(); assert.equal(next.session_id,event.session_id); assert.equal(next.event_seq,2);
});

test('旧能力探测迟到不能污染新身份或清理新队列', async () => {
  await setup(); cap='hold'; LGameAPI.track('old'); const old=LGameAPI.flushEvents(); const rejected=assert.rejects(old,{code:'SESSION_CHANGED'});
  await new Promise(resolve => setImmediate(resolve)); const previous=capabilityRequests[0];
  LGameAPI.clearSession(); identity='B'; cap=0; await LGameAPI.login(); const second=await track(); assert.equal(second.context,undefined);
  previous.respond(response({event_context_version:1})); await rejected;
  const third=await track(); assert.equal(third.context,undefined); assert.equal(probes,2); assert.equal(wire.some(events=>events.some(e=>e.event_key==='old')),false);
});

test('同来源init后登录不同身份清掉旧身份的操作会话与临时队列', async () => {
  await setup(); const first=await track(); LGameAPI.init(options()); LGameAPI.track('pending_old_identity'); identity='B'; await LGameAPI.login(); const second=await track();
  assert.notEqual(second.session_id,first.session_id); assert.equal(second.event_seq,1); assert.equal(wire.some(events=>events.some(e=>e.event_key==='pending_old_identity')),false);
});

test('各来源配置切换都新建会话，不能跨游戏地址、采集地址、平台、appid和开发模式', async () => {
  for (const extra of [{baseUrl:'https://other.example.test/api/'},{analyticsBaseUrl:'https://other.example.test/'},{getPlatform:()=> 'oppo'},{appid:'another'},{isDevMode:()=>true}]) {
    await setup(); const first=await track(); LGameAPI.init({...options(),...extra});
    // 开发登录响应沿用本测试的自动登录替身。
    await LGameAPI.login(); const second=await track(); assert.notEqual(second.session_id,first.session_id); assert.equal(second.event_seq,1);
  }
});


test('首次补齐UID沿用同账户操作会话并保留登录前事件', async () => {
  await setup(); LGameAPI.clearSession(); omitUserId=true;
  const id=LGameAPI.track('before_uid'); await LGameAPI.login(); assert.equal((await LGameAPI.flushEvents()).pendingCount,1);
  omitUserId=false; await LGameAPI.login(); await LGameAPI.flushEvents();
  assert.ok(wire.some(events=>events.some(e=>e.event_id===id)));
});

test('动态改变来源后再同来源init沿用当前来源的操作会话', async () => {
  const {applyConfig}=await import('../dist/index.js'); await setup(); await track();
  applyConfig({baseUrl:'https://newgame.example.test/api/',analyticsBaseUrl:'https://newcollect.example.test/'}); await LGameAPI.login(); const first=await track();
  LGameAPI.init({...options(),baseUrl:'https://newgame.example.test/api/',analyticsBaseUrl:'https://newcollect.example.test/'}); await LGameAPI.login(); const second=await track();
  assert.equal(second.session_id,first.session_id); assert.equal(second.event_seq,2);
});


async function manualTimers(run) {
  const originalSet=globalThis.setTimeout, originalClear=globalThis.clearTimeout, timers=new Set();
  globalThis.setTimeout=(callback,delay)=> { const timer={callback,delay,unref(){}}; timers.add(timer); return timer; };
  globalThis.clearTimeout=timer=>timers.delete(timer);
  const fire=async delay=> { const timer=[...timers].find(t=>t.delay===delay); assert.ok(timer,'应注册'+delay+'ms计时器'); timers.delete(timer); timer.callback(); await new Promise(resolve=>setImmediate(resolve)); };
  try { await run(fire); } finally { LGameAPI.clearSession(); globalThis.setTimeout=originalSet; globalThis.clearTimeout=originalClear; }
}

test('未触发XHR超时回调时1500ms兜底仍降级，迟到成功不升级旧wire', async () => {
  await setup();
  await manualTimers(async fire=> {
    cap='hold'; fail=true; LGameAPI.track('short_timeout'); const pending=LGameAPI.flushEvents(); await new Promise(resolve=>setImmediate(resolve)); const old=capabilityRequests[0];
    await fire(1500); assert.equal((await pending).pendingCount,1); const first=wire[0][0]; assert.equal(first.context,undefined);
    old.respond(response({event_context_version:1})); cap=1; fail=false; LGameAPI.track('after_timeout'); await LGameAPI.flushEvents();
    assert.deepEqual(wire.at(-1)[0],first); assert.ok(wire.at(-1)[1].context); assert.equal(probes,2);
  });
});

test('能力探测计入10秒总截止，截止后迟到成功绝不POST事件', async () => {
  await setup();
  await manualTimers(async fire=> {
    cap='hold'; LGameAPI.track('deadline'); const pending=LGameAPI.flushEvents(); await new Promise(resolve=>setImmediate(resolve)); const old=capabilityRequests[0];
    await fire(10000); assert.equal((await pending).error.code,'ANALYTICS_TIMEOUT'); old.respond(response({event_context_version:1})); await new Promise(resolve=>setImmediate(resolve)); assert.equal(wire.length,0);
    cap=1; await LGameAPI.flushEvents(); assert.equal(wire.length,1); assert.ok(wire[0][0].context); assert.equal(probes,2);
  });
});

test('扩展context计入UTF8批次和队列字节上限', async () => {
  await setup({app_version:'版'.repeat(128),os_name:'系'.repeat(128),device_model:'型'.repeat(128)});
  for(let i=0;i<49;i++) LGameAPI.track('sized',{text:'中'.repeat(2600)});
  await LGameAPI.flushEvents(); assert.equal(wire.flat().length,49); assert.ok(wire.length>1);
  for(const events of wire) { assert.ok(events.every(e=>!!e.context)); assert.ok(Buffer.byteLength(JSON.stringify({events}),'utf8')<=256*1024); }
  LGameAPI.clearSession(); let count=0;
  while(count<1000) { try { LGameAPI.track('queue'); count++; } catch(error) { assert.equal(error.code,'ANALYTICS_QUEUE_FULL'); break; } }
  assert.ok(count<1000); assert.equal((await LGameAPI.flushEvents()).pendingCount,count);
});


test('操作会话从init开始，首事件延后一分钟仍保留初始化时刻', async () => {
  const RealDate=globalThis.Date, start=RealDate.parse('2026-10-20T00:00:00.123Z'); let clock=start;
  globalThis.Date=class extends RealDate { constructor(value) { super(arguments.length ? value : clock); } static now() { return clock; } };
  try {
    await setup(); clock+=60000; const event=await track();
    assert.equal(event.session_started_at,new RealDate(start).toISOString()); assert.equal(event.occurred_at,new RealDate(start+60000).toISOString());
  } finally { globalThis.Date=RealDate; }
});

test('clearSession、换号及来源切换记录实际开始时刻，同来源init保留该时刻', async () => {
  const RealDate=globalThis.Date, start=RealDate.parse('2026-10-20T00:00:00.123Z'); let clock=start;
  globalThis.Date=class extends RealDate { constructor(value) { super(arguments.length ? value : clock); } static now() { return clock; } };
  try {
    await setup(); await track(); clock=start+60000; LGameAPI.clearSession(); await LGameAPI.login();
    clock=start+120000; const cleared=await track(); assert.equal(cleared.session_started_at,new RealDate(start+60000).toISOString());
    clock=start+180000; LGameAPI.init(options()); await LGameAPI.login(); clock=start+240000; const repeated=await track();
    assert.equal(repeated.session_id,cleared.session_id); assert.equal(repeated.session_started_at,cleared.session_started_at);
    clock=start+300000; identity='B'; await LGameAPI.login(); clock=start+360000; const switched=await track();
    assert.equal(switched.session_started_at,new RealDate(start+300000).toISOString()); assert.notEqual(switched.session_id,repeated.session_id);
    clock=start+420000; LGameAPI.init({...options(),appid:'new-clock-app'}); await LGameAPI.login(); clock=start+480000; const source=await track();
    assert.equal(source.session_started_at,new RealDate(start+420000).toISOString()); assert.notEqual(source.session_id,switched.session_id);
  } finally { globalThis.Date=RealDate; }
});


test('动态来源切换的异步登录不把操作会话开始时间推迟到登录完成', async () => {
  const {applyConfig}=await import('../dist/index.js');
  const RealDate=globalThis.Date, start=RealDate.parse('2026-10-20T00:00:00.123Z'); let clock=start;
  globalThis.Date=class extends RealDate { constructor(value) { super(arguments.length ? value : clock); } static now() { return clock; } };
  try {
    await setup(); await track(); clock=start+60000;
    let completeLogin; applyConfig({baseUrl:'https://async-source.example.test/api/',platformLogin:()=>new Promise(resolve=>{completeLogin=resolve;})});
    const pending=LGameAPI.login(); clock=start+120000; completeLogin({code:'delayed'}); await pending;
    clock=start+180000; const event=await track();
    assert.equal(event.session_started_at,new RealDate(start+60000).toISOString()); assert.equal(event.occurred_at,new RealDate(start+180000).toISOString());
  } finally { globalThis.Date=RealDate; }
});

test('清会话不调用可能抛错的来源适配器，延后恢复后仍保留清理时刻', async () => {
  const RealDate=globalThis.Date, start=RealDate.parse('2026-10-20T00:00:00.123Z'); let clock=start, throws=false;
  globalThis.Date=class extends RealDate { constructor(value) { super(arguments.length ? value : clock); } static now() { return clock; } };
  try {
    await setup({getPlatform:()=>{if(throws) throw Error('平台暂时不可用'); return 'wechat';}}); await track();
    clock=start+60000; throws=true; assert.doesNotThrow(()=>LGameAPI.clearSession());
    clock=start+120000; throws=false; await LGameAPI.login(); clock=start+180000; const event=await track();
    assert.equal(event.session_started_at,new RealDate(start+60000).toISOString());
  } finally { globalThis.Date=RealDate; }
});
