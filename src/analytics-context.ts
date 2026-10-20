/** 操作会话独立于登录凭据代次；仅受控的同来源初始化允许保留。 */
import { onSessionGenerationChange } from './session.js';
import { getAnalyticsMetadata } from './config.js';
import { SDK_VERSION } from './version.js';
import type { AnalyticsEventContext } from './types.js';
let initializing = false;
let source = '';
// 代次清理已经开始新会话，随后读取来源只更新快照，避免异步登录再次推迟开始时间。
let sourceResetPending = false;
let identity: { openId: string; userId: string } | undefined;
let sourceProvider: (() => string) | undefined;
// 会话开始先记录时间，UUID可延迟到首条事件生成。
let startedAt = new Date().toISOString();
let operation: { id: string; started: string; seq: number } | undefined;
function reset(): void { operation = undefined; identity = undefined; startedAt = new Date().toISOString(); }
onSessionGenerationChange(() => {
  if (!initializing) { reset(); sourceResetPending = true; }
});
export function initializeAnalyticsSession(action: () => void, getSource: () => string): void {
  initializing = true;
  try {
    action();
    const next = getSource();
    if (source !== next) reset();
    source = next;
    sourceProvider = getSource;
    sourceResetPending = false;
  } catch (error) { reset(); sourceResetPending = true; throw error; }
  finally { initializing = false; }
}
/** 重复 init 后登录到另一账户，不能继承旧操作会话和临时队列。 */
function synchronizeSource(): void {
  const next = sourceProvider?.();
  if (next !== undefined) {
    if (next !== source && !sourceResetPending) reset();
    source = next;
    sourceResetPending = false;
  }
}
export function confirmAnalyticsIdentity(openId: string, userId: string): boolean {
  synchronizeSource();
  const next = { openId, userId };
  const changed = !!identity && (identity.openId !== openId || (!!identity.userId && identity.userId !== userId));
  if (changed) reset();
  identity = next;
  return changed;
}
export function createEventContext(now: Date, uuid: () => string): { context: AnalyticsEventContext; session_id: string; session_started_at: string; event_seq: number } {
  synchronizeSource();
  if (!operation || operation.seq >= Number.MAX_SAFE_INTEGER) operation = { id: uuid(), started: operation ? now.toISOString() : startedAt, seq: 0 };
  return {
    context: { ...getAnalyticsMetadata(), sdk_version: SDK_VERSION, is_mock: false,
      client_event_at: new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 19).replace(/-/g, '/').replace('T', ' ') },
    session_id: operation.id, session_started_at: operation.started, event_seq: ++operation.seq,
  };
}
