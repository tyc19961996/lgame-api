/** 会话切换后，旧登录或业务请求必须由调用方丢弃。 */
import { getPlatform, isDevMode, getBaseUrl, getAnalyticsBaseUrl } from './config.js';

export class SessionChangedError extends Error {
  public readonly code = 'SESSION_CHANGED';
  constructor() { super('登录会话已变更，请丢弃旧请求结果'); this.name = 'SessionChangedError'; }
}

export interface SessionSnapshot {
  generation: number;
  openId: string;
  userId: string;
  token: string;
  expired: boolean;
  platform?: string;
  dev?: boolean;
  baseUrl?: string;
  analyticsBaseUrl?: string;
}

const generationListeners = new Set<() => void>();
/** 内部队列订阅代次变更，同账户刷新不触发。 */
export function onSessionGenerationChange(listener: () => void): () => void {
  generationListeners.add(listener); return () => generationListeners.delete(listener);
}
function notifyGenerationChange(): void { for (const listener of generationListeners) listener(); }

let current: SessionSnapshot = { generation: 0, openId: '', userId: '', token: '', expired: false };
export function getSession(): SessionSnapshot {
  // 自定义适配器可动态改变平台/开发模式，不能沿用原配置的已登录身份。
  if (current.platform !== undefined && (current.platform !== getPlatform() || current.dev !== isDevMode() || current.baseUrl !== getBaseUrl() || current.analyticsBaseUrl !== getAnalyticsBaseUrl())) clearSession();
  return current;
}
/** 登录尚未拿到玩家ID时，也先绑定配置，避免新平台被旧native任务占住。 */
export function bindLoginContext(platform: string, dev: boolean, baseUrl: string): void {
  current = { ...current, platform, dev, baseUrl, analyticsBaseUrl: getAnalyticsBaseUrl() };
}
export function clearSession(): void {
  current = { generation: current.generation + 1, openId: '', userId: '', token: '', expired: false };
  notifyGenerationChange();
}
export function markTokenExpired(token: string): void {
  if (current.token === token) current = { ...current, expired: true };
}
export function assertSession(snapshot: SessionSnapshot): void {
  getSession();
  if (snapshot.generation !== current.generation || snapshot.openId !== current.openId || (snapshot.userId && snapshot.userId !== current.userId)) throw new SessionChangedError();
}
export function assertGeneration(generation: number): void {
  getSession();
  if (generation !== current.generation) throw new SessionChangedError();
}
/** 一次替换整个对象，使 openId、userId 与 token 同步可见；同账户刷新不改变代次。 */
export function commitSession(generation: number, openId: string, token: string, refresh: boolean, userId: string): void {
  assertGeneration(generation);
  // 已知UID改变或消失也是换号；旧服务端始终无UID以及首次补UID保持兼容。
  const switched = !!current.openId && (current.openId !== openId || (!!current.userId && current.userId !== userId));
  if (refresh && switched) {
    clearSession();
    throw new SessionChangedError();
  }
  current = { generation: current.generation + (switched ? 1 : 0), openId, userId, token, expired: false,
    platform: getPlatform(), dev: isDevMode(), baseUrl: getBaseUrl(), analyticsBaseUrl: getAnalyticsBaseUrl() };
  if (switched) notifyGenerationChange();
}
