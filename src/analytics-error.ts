/** 打点入队、提交及配置错误。 */
export class AnalyticsError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'AnalyticsError'; }
}
