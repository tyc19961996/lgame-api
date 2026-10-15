/** 采集凭据只保存在内存；玩家JWT仅交给原游戏API。 */
import type { ApiResponse, AnalyticsEvent, AnalyticsResponseData } from './types.js';
import type { SessionSnapshot } from './session.js';
import { assertSession, getSession, onSessionGenerationChange } from './session.js';
import { getAnalyticsBaseUrl } from './config.js';
import { httpRequest } from './http.js';
import { AnalyticsError } from './analytics-error.js';

interface Credential { token: string; expires_at: number; }
export type AnalyticsSubmissionResponse = Omit<ApiResponse<AnalyticsResponseData>, 'code'> & { code: number | string };
let cached: Credential | undefined;
let pending: Promise<Credential> | undefined;
onSessionGenerationChange(() => { cached = undefined; pending = undefined; });

function invalidate(token: string): void { if (cached?.token === token) cached = undefined; }
function getCredential(session: SessionSnapshot, timeoutMs: number): Promise<Credential> {
  assertSession(session);
  if (cached && cached.expires_at * 1000 > Date.now() + 60000) return Promise.resolve(cached);
  if (pending) return pending;
  const promise = httpRequest<Credential>('analytics/credential', 'POST', {}, getSession().token, { timeoutMs }).then(response => {
    assertSession(session);
    if (response?.code !== 0) throw new AnalyticsError('ANALYTICS_CREDENTIAL_ERROR', typeof response?.message === 'string' ? response.message : '申请采集凭据失败');
    const value = response.data;
    if (!value || typeof value.token !== 'string' || !value.token.trim() || /[\r\n]/.test(value.token) || !Number.isSafeInteger(value.expires_at) || value.expires_at * 1000 <= Date.now()) {
      throw new AnalyticsError('ANALYTICS_CREDENTIAL_INVALID', '采集凭据响应缺少有效token或Unix秒到期时间');
    }
    cached = { token: value.token, expires_at: value.expires_at };
    return cached;
  });
  pending = promise;
  const finish = () => { if (pending === promise) pending = undefined; };
  void promise.then(finish, finish);
  return promise;
}

/** 独立请求不使用普通HTTP的玩家token参数，也不触发玩家登录。 */
function directRequest(baseUrl: string, events: AnalyticsEvent[], token: string, timeoutMs: number): Promise<{ status: number; response: AnalyticsSubmissionResponse }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${baseUrl}v1/events`, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.timeout = timeoutMs;
    xhr.ontimeout = () => reject(new Error('采集网络请求超时'));
    xhr.onerror = () => reject(new Error('采集网络错误'));
    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) return;
      let response: AnalyticsSubmissionResponse;
      try { response = JSON.parse(xhr.responseText); }
      catch {
        if (xhr.status !== 401) { reject(new AnalyticsError('ANALYTICS_RESPONSE_INVALID', '采集响应不是有效JSON')); return; }
      }
      if (xhr.status === 401) {
        resolve({ status: 401, response: response || { code: 'CREDENTIAL_INVALID', message: '采集凭据已失效', data: null, timestamp: '' } });
        return;
      }
      if (!response || typeof response !== 'object') { reject(new AnalyticsError('ANALYTICS_RESPONSE_INVALID', '采集响应格式错误')); return; }
      // HTTP失败不能被正文code=0伪装为成功确认。
      if (xhr.status < 200 || xhr.status >= 300) {
        response = { ...response, code: response.code === 0 ? xhr.status || 'ANALYTICS_HTTP_ERROR' : response.code };
      }
      resolve({ status: xhr.status, response });
    };
    xhr.send(JSON.stringify({ events }));
  });
}

/** 总截止时间由队列管理；每次异步继续前核对，避免截止后再发迟到请求。 */
export async function submitAnalyticsBatch(events: AnalyticsEvent[], session: SessionSnapshot, ensureActive: () => void, timeoutMs: number): Promise<AnalyticsSubmissionResponse> {
  const baseUrl = getAnalyticsBaseUrl();
  if (!baseUrl) return httpRequest<AnalyticsResponseData>('analytics/events', 'POST', { events }, getSession().token, { timeoutMs });
  let credential = await getCredential(session, timeoutMs);
  for (let attempt = 0; attempt < 2; attempt++) {
    ensureActive(); assertSession(session);
    const result = await directRequest(baseUrl, events, credential.token, timeoutMs);
    ensureActive(); assertSession(session);
    if (result.status !== 401) return result.response;
    invalidate(credential.token);
    if (attempt === 1) {
      throw new AnalyticsError(typeof result.response?.code === 'string' ? result.response.code : 'CREDENTIAL_INVALID', typeof result.response?.message === 'string' ? result.response.message : '采集凭据刷新后仍被拒绝');
    }
    credential = await getCredential(session, timeoutMs);
  }
  throw new AnalyticsError('CREDENTIAL_INVALID', '采集凭据无效');
}
