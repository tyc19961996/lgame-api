/** SDK统一管理有界打点队列；登录前暂存，登录成功后自动发送。 */
import type { AnalyticsEvent, AnalyticsEventError, AnalyticsEventResult, AnalyticsFlushResult, AnalyticsProperties, AnalyticsPropertyValue, AnalyticsResponseData, AnalyticsTrackOptions } from './types.js';
import { supportsEventContext, submitAnalyticsBatch } from './analytics-transport.js';
import { createEventContext, confirmAnalyticsIdentity } from './analytics-context.js';
import { AnalyticsError } from './analytics-error.js';
export { AnalyticsError } from './analytics-error.js';
import { getSession, assertSession, bindLoginContext, onSessionGenerationChange, SessionChangedError } from './session.js';
import { getBaseUrl, getPlatform, isDevMode, getAnalyticsBaseUrl } from './config.js';
import type { SessionSnapshot } from './session.js';

const MAX_PROPERTIES_BYTES = 8 * 1024;
const MAX_BATCH_BYTES = 256 * 1024;
const MAX_BATCH_EVENTS = 50;
const MAX_QUEUE_BYTES = 1024 * 1024;
const MAX_QUEUE_EVENTS = 1000;
const FLUSH_INTERVAL_MS = 5000;
const SUBMISSION_TIMEOUT_MS = 10000;
const MAX_RETRY_INTERVAL_MS = 30000;

interface QueueEntry { event: AnalyticsEvent; bytes: number; wire?: AnalyticsEvent; }
interface QueueState {
  entries: QueueEntry[];
  bytes: number;
  timer?: ReturnType<typeof setTimeout>;
  flushPromise?: Promise<AnalyticsFlushResult>;
  automaticFailures: number;
  recoveryRequested: boolean;
}
const emptyQueue = (): QueueState => ({ entries: [], bytes: 0, automaticFailures: 0, recoveryRequested: false });
let queue = emptyQueue();
let resultHandler: ((result: AnalyticsFlushResult) => void) | undefined;
onSessionGenerationChange(() => { cancelTimer(queue); queue = emptyQueue(); });

/** 初始化时替换观察者，避免沿用上一游戏的回调。 */
let recoveryGeneration = 0;
let detachRecovery: Array<() => void> = [];
export function configureAnalytics(handler?: (result: AnalyticsFlushResult) => void): void {
  // 先使旧回调失效，再解绑；平台解绑异常也不能唤醒下一应用的队列。
  const generation = ++recoveryGeneration;
  for (const detach of detachRecovery) { try { detach(); } catch { /* 平台监听不可用时保留定时退避。 */ } }
  detachRecovery = [];
  resultHandler = handler;
  try {
    const names: Record<string, string> = { wechat: 'wx', ali: 'my', ks: 'ks', bytedance: 'tt', bilibili: 'bl', oppo: 'qg' };
    const platform = getPlatform();
    const name = names[platform];
    if (!name) return;
    const scope = globalThis as unknown as Record<string, unknown>;
    const win = scope.window as Record<string, unknown> | undefined;
    const api = (scope[name] || win?.[name]) as Record<string, unknown> | undefined;
    if (!api) return;
    const listen = (on: string, off: string, listener: (value?: { isConnected?: boolean }) => void): void => {
      const add = api[on], remove = api[off];
      if (typeof add !== 'function' || typeof remove !== 'function') return;
      const current = (value?: { isConnected?: boolean }): void => {
        try { if (generation === recoveryGeneration && getPlatform() === platform) listener(value); }
        catch { /* 可选恢复提示异常不影响原平台生命周期。 */ }
      };
      try { add.call(api, current); detachRecovery.push(() => remove.call(api, current)); }
      catch { /* 可选平台监听失败不影响SDK初始化或后续退避。 */ }
    };
    listen('onShow', 'offShow', () => recoverAnalytics());
    listen('onNetworkStatusChange', 'offNetworkStatusChange', value => { if (value?.isConnected === true) recoverAnalytics(); });
  } catch { /* 自定义运行时不支持恢复信号时仍由封顶退避重试。 */ }
}
/** SDK内部恢复通知只作用于当前队列，业务不需要额外flush或身份缓存。 */
function recoverAnalytics(): void {
  const target = queue, session = getSession();
  if (target !== queue || !target.entries.length || !session.token || !session.openId || !session.userId) return;
  cancelTimer(target);
  if (target.flushPromise) { target.recoveryRequested = true; return; }
  target.automaticFailures = 0;
  automaticFlush(true);
}

/** 不依赖TextEncoder，兼容小游戏运行时；代理对按UTF8四字节计算。 */
function utf8Bytes(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
    else bytes += 3;
  }
  return bytes;
}
function invalidProperties(): never { throw new AnalyticsError('ANALYTICS_PARAM_INVALID', 'properties必须是有限数值、字符串、布尔、null、数组或普通JSON对象，不能循环引用'); }
function cloneValue(value: unknown, ancestors: Set<object>): AnalyticsPropertyValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value as AnalyticsPropertyValue;
  if (typeof value === 'number') { if (!Number.isFinite(value)) invalidProperties(); return value; }
  if (typeof value !== 'object' || ancestors.has(value)) invalidProperties();
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) invalidProperties();
  ancestors.add(value);
  let cloned: AnalyticsPropertyValue;
  if (Array.isArray(value)) cloned = Array.from(value, item => cloneValue(item, ancestors));
  else {
    const object: AnalyticsProperties = Object.create(null);
    for (const key of Object.keys(value)) object[key] = cloneValue(value[key], ancestors);
    cloned = object;
  }
  ancestors.delete(value);
  return cloned;
}
function snapshotProperties(properties: AnalyticsProperties): AnalyticsProperties {
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) invalidProperties();
  try { return cloneValue(properties, new Set()) as AnalyticsProperties; }
  catch (error) { if (error instanceof AnalyticsError) throw error; invalidProperties(); }
}
function eventId(): string {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
}
function cancelTimer(target: QueueState): void {
  if (target.timer !== undefined) { clearTimeout(target.timer); target.timer = undefined; }
}
function schedule(target: QueueState): void {
  const session = getSession();
  if (!session.token || !session.openId || !session.userId) return;
  if (target !== queue || !target.entries.length || target.flushPromise || target.timer !== undefined) return;
  const delay = Math.min(MAX_RETRY_INTERVAL_MS, FLUSH_INTERVAL_MS * 2 ** Math.max(0, Math.min(target.automaticFailures - 1, 4)));
  target.timer = setTimeout(() => { target.timer = undefined; if (target === queue) automaticFlush(true); }, delay);
  const timer = target.timer as unknown as { unref?: () => void };
  if (typeof timer?.unref === 'function') timer.unref();
}
function automaticFlush(force = false): void {
  const session = getSession();
  if (!session.token || !session.openId || !session.userId) return;
  // 新事件达到50条也不能绕过失败退避；定时器和恢复通知才可加速重试。
  if (!force && queue.automaticFailures > 0) { schedule(queue); return; }
  // 自动上报的会话失效由队列清理处理，不产生未处理异常。
  void flushAnalytics(true).catch(() => undefined);
}

/** 返回已入队事件ID；服务端确认必须等待flushEvents结果。 */
export function trackEvent(eventName: string, properties: AnalyticsProperties = {}, options: AnalyticsTrackOptions = {}): string {
  getBaseUrl();
  let session = getSession();
  // 首次登录前也绑定初始化配置；平台或地址变化由SDK清掉旧来源队列。
  if (session.platform === undefined) {
    bindLoginContext(getPlatform(), isDevMode(), getBaseUrl());
    session = getSession();
  }
  if (session.token && session.openId && !session.userId) throw new AnalyticsError('ANALYTICS_UID_REQUIRED', '登录响应缺少user_id，请升级服务端并重新登录后打点');
  if (typeof eventName !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(eventName)) throw new AnalyticsError('ANALYTICS_PARAM_INVALID', 'eventName必须以英文字母开头，最长64字符，仅允许字母、数字和下划线');
  const schemaVersion = options?.schemaVersion === undefined ? 1 : options.schemaVersion;
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) throw new AnalyticsError('ANALYTICS_PARAM_INVALID', 'schemaVersion必须是正整数');
  const snapshot = snapshotProperties(properties);
  if (utf8Bytes(JSON.stringify(snapshot)) > MAX_PROPERTIES_BYTES) throw new AnalyticsError('ANALYTICS_EVENT_TOO_LARGE', '单个事件properties的UTF8 JSON不能超过8KiB');
  const now = new Date();
  const event: AnalyticsEvent = { event_id: eventId(), event_key: eventName, schema_version: schemaVersion, occurred_at: now.toISOString(), properties: snapshot, ...createEventContext(now, eventId) };
  const bytes = utf8Bytes(JSON.stringify(event)) + 1;
  // 属性访问器或自定义运行时可能在同步求值期间切换身份，入队前重新核对。
  assertSession(session);
  // 额外12字节覆盖events外层和数组分隔符，包含正在提交但尚未确认的事件。
  if (queue.entries.length >= MAX_QUEUE_EVENTS || queue.bytes + bytes + 12 > MAX_QUEUE_BYTES) throw new AnalyticsError('ANALYTICS_QUEUE_FULL', '打点队列已达到1000条或1MiB，请flush后重试');
  queue.entries.push({ event, bytes }); queue.bytes += bytes;
  if (queue.entries.length >= MAX_BATCH_EVENTS) automaticFlush(); else schedule(queue);
  return event.event_id;
}
function removeConfirmed(target: QueueState, confirmed: Set<string>): void {
  target.entries = target.entries.filter(entry => {
    if (!confirmed.has(entry.event.event_id)) return true;
    target.bytes -= entry.bytes; return false;
  });
}
function notifyResult(target: QueueState, result: AnalyticsFlushResult): void {
  if (target !== queue || !resultHandler) return;
  try {
    const possiblePromise: unknown = resultHandler(result);
    // 也接住调用方误用async回调时产生的拒绝。
    if (possiblePromise && typeof (possiblePromise as Promise<void>).then === 'function') void Promise.resolve(possiblePromise).catch(() => undefined);
  } catch { /* 观察者异常不影响事件确认和队列状态。 */ }
}
function validEventError(value: unknown): value is AnalyticsEventError {
  if (!value || typeof value !== 'object') return false;
  const error = value as AnalyticsEventError;
  return (typeof error.code === 'string' || typeof error.code === 'number') && typeof error.message === 'string' && (error.field === undefined || typeof error.field === 'string');
}
function confirmResults(target: QueueState, batch: QueueEntry[], data: AnalyticsResponseData, results: AnalyticsEventResult[]): boolean {
  if (!data || !Array.isArray(data.results)) return false;
  const byId = new Map<string, AnalyticsEventResult[]>();
  let valid = true;
  const expected = new Set(batch.map(entry => entry.event.event_id));
  for (const result of data.results) {
    if (!result || !expected.has(result.event_id)) { valid = false; continue; }
    const same = byId.get(result.event_id) || []; same.push(result); byId.set(result.event_id, same);
  }
  const confirmed = new Set<string>();
  for (const entry of batch) {
    const matching = byId.get(entry.event.event_id);
    const result = matching?.[0];
    if (matching?.length !== 1 || !['accepted', 'duplicate', 'rejected'].includes(result?.status) || (result.status === 'rejected' && !validEventError(result.error))) { valid = false; continue; }
    confirmed.add(entry.event.event_id);
    results.push({ event_id: result.event_id, status: result.status, ...(result.status === 'rejected' ? { error: { ...result.error } } : {}) });
  }
  removeConfirmed(target, confirmed);
  return valid;
}
/** 截止时间覆盖凭据、采集、401换凭据与402登录，不取消其他业务共享的刷新。 */
async function withSubmissionDeadline<T>(request: (ensureActive: () => void) => Promise<T>): Promise<T> {
  let active = true;
  const ensureActive = () => { if (!active) throw new AnalyticsError('ANALYTICS_TIMEOUT', '打点批次已超过10秒截止时间'); };
  let timer: ReturnType<typeof setTimeout>;
  let stopWatching: () => void = () => undefined;
  const deadline = new Promise<T>((_, reject) => {
    timer = setTimeout(() => { active = false; reject(new AnalyticsError('ANALYTICS_TIMEOUT', '打点批次提交超过10秒，未确认事件保留待重试')); }, SUBMISSION_TIMEOUT_MS);
    const handle = timer as unknown as { unref?: () => void };
    if (typeof handle?.unref === 'function') handle.unref();
    stopWatching = onSessionGenerationChange(() => {
      active = false;
      clearTimeout(timer);
      reject(new SessionChangedError());
    });
  });
  try {
    // race为在途请求持续保留拒绝处理器，截止后迟到响应不会再进入事件确认。
    return await Promise.race([request(ensureActive), deadline]);
  } finally {
    active = false;
    clearTimeout(timer);
    stopWatching();
  }
}
async function submitSnapshot(target: QueueState, session: SessionSnapshot, snapshot: QueueEntry[]): Promise<AnalyticsFlushResult> {
  const results: AnalyticsEventResult[] = [];
  let error: AnalyticsEventError | undefined;
  while (snapshot.length) {
    assertSession(session);
    const token = getSession().token;
    const batch: QueueEntry[] = [];
    for (const entry of snapshot) {
      if (batch.length >= MAX_BATCH_EVENTS) break;
      const candidates = [...batch, entry];
      if (utf8Bytes(JSON.stringify({ events: candidates.map(item => item.event), ...(getAnalyticsBaseUrl() ? {} : { token }) })) > MAX_BATCH_BYTES) break;
      batch.push(entry);
    }
    if (!batch.length) { error = { code: 'ANALYTICS_BATCH_TOO_LARGE', message: '当前事件请求超过256KiB' }; break; }
    let response;
    try { response = await withSubmissionDeadline(async ensureActive => {
      const extended = batch.some(entry => !entry.wire) ? await supportsEventContext(session, ensureActive) : false;
      ensureActive(); assertSession(session);
      for (const entry of batch) {
        if (!entry.wire) {
          const event = entry.event;
          entry.wire = extended ? event : { event_id: event.event_id, event_key: event.event_key, schema_version: event.schema_version, occurred_at: event.occurred_at, properties: event.properties };
        }
      }
      return submitAnalyticsBatch(batch.map(entry => entry.wire), session, ensureActive, SUBMISSION_TIMEOUT_MS);
    }); }
    catch (caught) {
      assertSession(session);
      if (caught instanceof SessionChangedError) throw caught;
      error = { code: caught instanceof AnalyticsError ? caught.code : 'ANALYTICS_NETWORK_ERROR', message: caught instanceof Error ? caught.message : '打点网络请求失败' }; break;
    }
    assertSession(session);
    if (response?.code !== 0) {
      error = { code: (typeof response?.code === 'number' || typeof response?.code === 'string') ? response.code : 'ANALYTICS_RESPONSE_INVALID', message: typeof response?.message === 'string' ? response.message : '打点响应格式错误' };
      if (([400, 410, 411, 'APP_NOT_REGISTERED', 'APP_DISABLED', 'BINDING_DISABLED', 'INVALID_BATCH', 'INVALID_IDENTITY', 'INVALID_INPUT'] as Array<number | string>).includes(response?.code)) {
        for (const entry of batch) results.push({ event_id: entry.event.event_id, status: 'rejected', error: { ...error } });
        removeConfirmed(target, new Set(batch.map(entry => entry.event.event_id)));
      } else break;
    } else if (!confirmResults(target, batch, response.data, results)) {
      error = { code: 'ANALYTICS_RESPONSE_INVALID', message: '打点响应缺少完整有效的事件确认，未确认事件保留待重试' }; break;
    }
    snapshot = snapshot.slice(batch.length);
  }
  assertSession(session);
  return { results, pendingCount: target.entries.length, ...(error ? { error } : {}) };
}

/** 单飞提交调用时的队列快照；网络失败返回error并保留未确认事件。 */
export function flushAnalytics(automatic = false): Promise<AnalyticsFlushResult> {
  const session = getSession();
  const target = queue;
  if (!target.entries.length) return Promise.resolve({ results: [], pendingCount: 0 });
  if (!session.token || !session.openId) return Promise.resolve({ results: [], pendingCount: target.entries.length });
  if (!session.userId) return Promise.resolve({ results: [], pendingCount: target.entries.length, error: { code: 'ANALYTICS_UID_REQUIRED', message: '登录响应缺少user_id，事件保留等待有效登录' } });
  if (target.flushPromise) return target.flushPromise;
  if (!target.entries.length) return Promise.resolve({ results: [], pendingCount: 0 });
  cancelTimer(target);
  const promise = submitSnapshot(target, session, target.entries.slice()).then(result => {
    if (target === queue) {
      if (!result.error || result.pendingCount === 0) target.automaticFailures = 0;
      else target.automaticFailures++;
      notifyResult(target, result);
    }
    return result;
  });
  target.flushPromise = promise;
  const finish = () => {
    if (target !== queue || target.flushPromise !== promise) return;
    target.flushPromise = undefined;
    if (target.recoveryRequested) {
      target.recoveryRequested = false;
      target.automaticFailures = 0;
      automaticFlush(true);
    } else schedule(target);
  };
  void promise.then(finish, finish).catch(() => undefined);
  return promise;
}

/** 登录成功后启动已有队列，业务调用方无需重复发送或手动flush。 */
export function analyticsLoginCompleted(flush = true): void {
  const session = getSession();
  if (confirmAnalyticsIdentity(session.openId, session.userId)) { cancelTimer(queue); queue = emptyQueue(); }
  if (!flush || !queue.entries.length) return;
  if (!session.token || !session.openId) return;
  if (!session.userId) {
    notifyResult(queue, { results: [], pendingCount: queue.entries.length, error: { code: 'ANALYTICS_UID_REQUIRED', message: '登录响应缺少user_id，事件保留等待有效登录' } });
    return;
  }
  automaticFlush();
}
