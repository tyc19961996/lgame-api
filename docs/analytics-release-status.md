# 1.10.0源码交接与发布状态

日期：2026-10-15。本轮同步Git源码，npm发布是独立步骤，本次没有执行npm publish。

## 本版内容

- 新增track、flushEvents和onAnalyticsResult，复制属性快照并使用稳定event_id进行重试；逐条accepted、duplicate、rejected由服务端结果确认。
- 登录前可有界入队，登录取得可信玩家编号后补发；账号、应用、已知UID或采集地址变化时隔离旧请求与队列。
- 网络失败持续退避，可用的平台前台与网络恢复通知会触发恢复；保持单飞及批次总截止时间。
- analyticsBaseUrl可选启用独立采集直传：游戏API只核验玩家并签发短期凭据，事件直接发送采集服务。玩家JWT保留在原游戏API，采集主机只收到专用票据和事件。
- 不配置直传地址的项目保留原analytics/events通道；配置直传后失败不会跨主机回退。

协议、初始化示例及错误处理见[自定义打点](analytics.md)，1.9.1阶段的恢复修复过程见[历史记录](analytics-recovery.md)。公开文档只使用示例服务地址和AppID，不包含服务端部署配置、数据库脚本、密钥或玩家数据。

## 验证和使用

本轮npm test通过，其中包含TypeScript构建、时间戳与平台登录、19项会话、41项队列/恢复、16项直传及公开类型检查。包入口为dist/index.js与dist/index.d.ts，运行构建生成；Git不收录dist、node_modules或本地tgz。

README中的npm安装方式获取的是npm当前已发布版本，不能仅因Git源码version为1.10.0就认定npm已经发布该版本。需要当前源码时，可使用GitHub main或本地构建包；项目应单独核对实装版本并锁定依赖。正式手机的断网/后台恢复、超过15分钟续票及生产容量需在各项目实际环境继续验收，本地测试不替代它们。
