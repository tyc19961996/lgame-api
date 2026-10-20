import { LGameAPI } from '../dist/index.js';
import type { AnalyticsTrackOptions } from '../dist/index.js';
// 历史包装器可透传未指定的第三参数，新SDK不应使其编译失败。
const forward = (options?: AnalyticsTrackOptions): string => LGameAPI.track('start', {}, options);
const plain = LGameAPI.track('start', {}, undefined);
void [forward, plain];
