import { LGameAPI, AnalyticsError } from '../src/index.js';
import type { AnalyticsProperties, AnalyticsTrackOptions, AnalyticsFlushResult, AnalyticsEvent, AnalyticsEventResult, LGameApiOptions } from '../src/index.js';
const properties: AnalyticsProperties = { score: 10, first: true, labels: ['开始', null], detail: { level: 1 } };
const options: AnalyticsTrackOptions = { schemaVersion: 2 };
const eventId: string = LGameAPI.track('level_start', properties, options);
const pending: Promise<AnalyticsFlushResult> = LGameAPI.flushEvents();
const event: AnalyticsEvent = { event_id: eventId, event_key: 'level_start', schema_version: 2, occurred_at: '2026-10-13T00:00:00.000Z', properties };
const rejected: AnalyticsEventResult = { event_id: eventId, status: 'rejected', error: { code: 'PROPERTY_TYPE_INVALID', message: '属性类型无效', field: 'properties.score' } };
const init: LGameApiOptions = { baseUrl: 'https://example.com/api/v1/', analyticsBaseUrl: 'https://analytics.example.com/', onAnalyticsResult: result => { const pendingCount: number = result.pendingCount; void pendingCount; } };
const error: Error = new AnalyticsError('ANALYTICS_LOGIN_REQUIRED', '请先登录');
// @ts-expect-error 属性不接受函数。
LGameAPI.track('start', { calculate: () => 1 });
// @ts-expect-error schema版本必须是number。
LGameAPI.track('start', {}, { schemaVersion: 'latest' });
// @ts-expect-error 事件中不能自报用户归属。
const forged: AnalyticsEvent = { ...event, user_id: 'forged' };
void [pending, rejected, init, error, forged];
