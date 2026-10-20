# 自定义打点（SDK 1.11.0）

使用前，服务端需支持登录返回 `user_id`，并完成应用登记、来源授权和事件Schema配置。原通道需支持 `POST /api/v1/analytics/events`；直传需支持下文凭据和独立采集协议。客户端沿用 `LGameAPI.init` 的 `baseUrl` 与登录流程。可选 `analyticsBaseUrl` 启用独立采集直传：原游戏API只签发短期采集凭据，事件直接发送到采集服务；归属由服务端签发的凭据确定。省略或传空字符串时继续使用原 `analytics/events` 通道。

## 初始化与入队

`init` 后即可调用 `track`。登录前事件由 SDK 有界暂存，不发请求、不启动发送计时器；正常调用 `login()` 成功取得有效用户编号后，SDK 自动发送已有事件。游戏无需再维护登录队列、比较 APPID/userId 或在登录后手动重放事件。归属由服务端解析 JWT 确定。旧服务端缺少 `user_id` 时，原业务保持兼容，采集保持禁止并给出 `ANALYTICS_UID_REQUIRED`。

```typescript
import { LGameAPI, AnalyticsError } from 'lgame-api';

LGameAPI.init({
  baseUrl: 'https://example.com/api/v1/',
  analyticsBaseUrl: 'https://analytics.example.com/', // 可选：独立采集服务根地址
  appid: 'your-app-id',
  app_version: '1.0.0', // 可选：游戏发布版本
  os_name: 'Android', // 可选：调用方已知的系统名称
  device_model: '示例机型', // 可选：调用方已知的设备型号，SDK不自行探测
  onAnalyticsResult: result => {
    for (const item of result.results) {
      if (item.status === 'rejected') {
        console.warn('事件永久拒绝', item.event_id, item.error?.code, item.error?.field);
      }
    }
    if (result.error) console.warn('批次上报失败', result.error.code, result.pendingCount);
  },
});

// 初始加载事件直接交给 SDK，登录成功后会自动发送。
LGameAPI.track('loading_start', {});

const login = await LGameAPI.login();
if (login.code !== 0) throw new Error('登录失败');

try {
  const eventId = LGameAPI.track('level_start', { level_id: 1, first_attempt: true }, { schemaVersion: 1 });
  console.log('已入队', eventId);
} catch (error) {
  if (error instanceof AnalyticsError) console.warn('入队失败', error.code, error.message);
  else throw error;
}
```

签名：

```typescript
LGameAPI.track(eventName: string, properties?: AnalyticsProperties, options?: { schemaVersion?: number }): string;
LGameAPI.flushEvents(): Promise<AnalyticsFlushResult>;
```

事件名以英文字母开头，最长64字符，只允许字母、数字和下划线。Schema版本由调用方明确指定，省略时固定使用1；事件需在后台登记对应版本，SDK不会猜测最新版本。属性只接受JSON对象，内部值可包含有限数值、字符串、布尔、null、数组和普通对象；函数、undefined、BigInt、Date、非有限数值及循环引用会被拒绝。

`track` 同步生成UUID和ISO发生时间，并复制属性快照。调用方后续修改原对象不会改变待发送事件。返回事件ID表示已入队，服务端确认结果需通过 `flushEvents` 或 `onAnalyticsResult` 读取。

## 批量提交与确认

```typescript
const result = await LGameAPI.flushEvents();
for (const item of result.results) {
  if (item.status === 'accepted' || item.status === 'duplicate') {
    console.log('已确认', item.event_id);
  } else {
    console.warn('永久失败', item.event_id, item.error);
  }
}
if (result.error) {
  console.warn('部分事件暂未确认', result.error, result.pendingCount);
}
```

`AnalyticsFlushResult`：

```typescript
{
  results: Array<{
    event_id: string;
    status: 'accepted' | 'duplicate' | 'rejected';
    error?: { code: number | string; message: string; field?: string };
  }>;
  pendingCount: number;
  error?: { code: number | string; message: string; field?: string };
}
```

`accepted` 和 `duplicate` 都表示服务端已确认，事件从队列移除。`rejected` 表示永久拒绝，携带服务端错误码、原因和可选字段，不会再次重传。同一个批次允许混合这三种结果。

`flushEvents` 串行分批提交任务开始时的队列快照，发送期间新入队事件会保留。并发调用会复用当前提交任务，包括已经开始的自动任务；`pendingCount` 给出任务结束时剩余数量，调用方可在合适时机再次调用。已由自动任务确认的事件可从初始化回调观察，后续空队列调用返回 `{ results: [], pendingCount: 0 }`。

每个打点批次有10秒总截止时间，覆盖能力探测、凭据申请、采集HTTP、401换凭据、402静默平台登录、登录HTTP和重试；截止后返回`ANALYTICS_TIMEOUT`并释放打点提交任务，未确认事件留队列，迟到结果不再确认队列，直传任务也不会在截止后继续发起事件请求或401换凭据，其他业务共享的静默刷新可以继续。网络错误、XHR请求超时、503和504会返回 `error`，未确认事件保留，下一次提交保持相同事件ID、发生时间和属性。异常或缺失的事件确认也会返回 `ANALYTICS_RESPONSE_INVALID` 并保留未确认事件。批次错误400、应用未注册410、应用或来源停用411会把该批事件终结为逐条 `rejected`，同时设置批次 `error`。调用方需分别检查 `results` 和 `error`，不能把Promise正常返回当作全部成功。

未登录调用 `flushEvents` 返回当前待发送数量而不联网；登录成功后由 SDK 自动提交。提交期间账号或应用改变会拒绝为 `SessionChangedError`（`code: 'SESSION_CHANGED'`），调用方应丢弃该旧任务结果。

## 队列与生命周期

- 登录前只暂存。显式 login 成功后立即排空此前队列；已登录阶段首次入队后5秒自动提交，积累到50条立即提交。每次请求最多50条，总UTF8 JSON不超过256KiB（原通道包含登录token，直传只含events）；属性JSON最多8KiB。自动context和会话字段也计入批次与内存队列的UTF8字节上限。
- 内存队列上限1000条或1MiB，以先达到的限制为准，包含正在发送但尚未确认的事件。溢出同步抛出 `ANALYTICS_QUEUE_FULL`，已入队事件保留。队列不持久化，进程退出时尚未确认事件会丢失。
- 暂时失败保留原事件，并按5、10、20、30秒封顶持续退避，成功后恢复正常5秒批量调度。失败期间达到50条也不绕过退避；显式 `flushEvents` 仍可立即尝试。SDK对当前平台可用的成对前台/联网监听注册恢复通知，回前台或恢复联网会唤醒已有队列，不需要游戏加队列、身份判断或手动补发。无可用监听的平台继续定时退避。所有自动结果通过 `onAnalyticsResult` 观察，回调异常会被捕获。
- `clearSession`、重新 `init`、AppID或开发ID改变、登录换账号或已知UID改变/缺失、动态平台/开发模式/服务地址或采集地址改变都会清理旧队列、计时器和缓存凭据。切换前需先完成希望保留的事件提交；旧事件不会使用新会话上报。
- 同账号的402令牌刷新沿用现有单飞登录机制，保留事件ID和队列。静默刷新换成其他账号或已知UID改变/缺失时会拒绝旧请求并清理队列；相同openid也会核对已知UID。
- Node环境支持 `unref` 的计时器不会阻止进程退出；自动请求和观察回调不会产生未处理Promise异常。

## 公开采集协议

未设置 `analyticsBaseUrl` 时，沿用登录HTTP上下文发送 `POST /api/v1/analytics/events`：

```json
{
  "events": [
    {
      "event_id": "52757745-f452-480f-9c2f-95ff5856d998",
      "event_key": "level_start",
      "schema_version": 1,
      "occurred_at": "2026-10-13T00:00:00.000Z",
      "properties": { "level_id": 1 }
    }
  ]
}
```

SDK自动携带原有登录token；事件本身不提交platform、appid或user_id。标准响应为 `{ code, message, data: { results }, timestamp }`。基础采集协议兼容 `lgame-api@1.9.0`；停发恢复能力需要 `lgame-api@1.9.1` 或更新版本，独立采集直传需要 `lgame-api@1.10.0`。服务端须支持对应协议并在登录响应中返回用户编号。


## 独立采集直传（1.10.0）

`analyticsBaseUrl` 使用采集服务根地址，SDK拼接 `v1/events`。默认只允许HTTPS；本地测试允许 `http://localhost`、`http://127.0.0.1` 和 `http://[::1]`，可附端口。地址不能包含用户名、密码、查询、片段、空白或反斜线。每次 `init` 省略此项会回到原通道；动态 `applyConfig` 只有显式设置此项才替换当前值。小游戏平台需把游戏API和采集服务分别加入请求域名白名单；浏览器采集服务需允许对应来源及 `Authorization`、`Content-Type` 请求头。

登录并取得有效用户编号后，SDK先向原 `baseUrl` 发送 `POST analytics/credential`，沿用游戏API原有JSON中的玩家token参数。成功响应为 `{ code: 0, data: { token, expires_at }, message, timestamp }`，其中 `expires_at` 是Unix秒。凭据由服务端签发，默认有效15分钟，SDK在到期前60秒更新；同一会话的在途申请单飞共享。凭据仅缓存在内存，业务无需读取或保存。

随后向 `${analyticsBaseUrl}v1/events` 发送 `POST`，请求头为 `Authorization: Bearer <采集凭据>`，JSON正文为 `{ events }`；单条事件是否包含扩展字段由下文能力协商决定。SDK不会向该采集主机发送玩家JWT，也不在正文添加token、user、identity、appid或platform。独立采集发生错误时不会改向游戏API转发事件。

采集HTTP401时，SDK清理被拒绝的凭据、重新申请并用原事件最多重试一次；依据HTTP状态判定，正文同名错误码不会单独触发更新。再次401会返回错误并保留事件，后续由原退避机制重试。只有原游戏API凭据接口的玩家令牌过期 `code=402` 沿用现有静默登录，采集服务响应不触发玩家登录。

采集服务的 `APP_NOT_REGISTERED`、`APP_DISABLED`、`BINDING_DISABLED`、`INVALID_BATCH`、`INVALID_IDENTITY`、`INVALID_INPUT` 按原通道永久错误语义终结本批事件，结果保留原字符串错误码。`COLLECTOR_BUSY`、`DATABASE_ERROR`、网络/超时及未识别错误保留事件等待重试。HTTP非2xx不会被正文 `code=0` 当作成功确认。

## 自动上下文与操作会话（1.11.0）

`app_version`、`os_name`、`device_model` 是 `init` 的三个可选字符串字段。每项最多128字符，禁止C0/C1控制字符，去除两端空白后为空则记录为 `null`；省略也记录为 `null`，传入非字符串会同步报错。SDK不探测操作系统或设备型号，也不从业务属性猜测这些值。每次 `track` 都复制当前初始化字段，后续配置更新只影响新事件。

支持扩展协议时，事件保留原五个字段，并增加以下字段：

```json
{
  "context": {
    "app_version": "1.0.0",
    "sdk_version": "1.11.0",
    "os_name": "Android",
    "device_model": "示例机型",
    "is_mock": false,
    "client_event_at": "2026/10/20 08:00:00"
  },
  "session_id": "ce432d7d-3529-4588-9615-a7093259ef81",
  "session_started_at": "2026-10-20T00:00:00.123Z",
  "event_seq": 1
}
```

`sdk_version` 来自包内版本模块，与本包版本一致。`context.is_mock` 固定为 `false`，真实SDK事件不接受游戏自行标记为模拟玩家。`client_event_at` 在 `track` 时以北京时间生成，格式固定为 `YYYY/MM/DD HH:mm:ss`；原有 `occurred_at` 继续使用含毫秒的ISO时间，不改变语义。`properties` 保留原始业务快照；旧Schema若要求其中的同名属性，游戏仍需按原Schema传入，SDK不覆盖、不删除或移入 `context`。

`session_id` 是SDK生成的UUID，`session_started_at` 是初始化或会话切换时记录的含毫秒ISO时间，首个事件即使延后产生也保留该开始时刻，`event_seq` 从1开始安全递增；同一毫秒的事件也有不同序号。登录前暂存和登录后事件沿用同一操作会话，同账户令牌刷新不重置。进程冷启动、显式 `clearSession`、换号或已知UID改变、游戏地址/采集地址/平台/AppID/开发模式或开发ID切换会新建操作会话。

同来源重复 `init` 继续清理旧登录状态、在途请求和事件队列，以保持原有身份隔离；操作会话ID和序号会保留，重新登录同账户后继续递增。重复初始化后登录到其他账户会重置操作会话并清理等待期间的临时事件。初始化三字段可更新为新版本或新设备描述，已发送或待重试事件的快照不变。

## 采集能力协商与旧服务端兼容

只有显式配置 `analyticsBaseUrl` 的直传路径会探测公开的 `GET ${analyticsBaseUrl}v1/capabilities`。请求不携带JWT、采集凭据或正文，服务端支持响应为：

```json
{ "code": 0, "data": { "event_context_version": 1 } }
```

仅收到成功HTTP状态及上述数值能力时发送扩展字段。HTTP404、网络错误、1500毫秒超时或无效响应均使用原协议，事件严格只有 `event_id`、`event_key`、`schema_version`、`occurred_at`、`properties`。未配置独立地址时始终使用原五字段，不向游戏API探测能力。扩展采集服务需开放此GET路由及浏览器跨域访问。

成功能力缓存在当前来源和登录代次内；404缓存15秒，网络、超时和无效响应不长期缓存，后续新事件可重新探测。账号、来源或初始化代次改变后，旧在途能力响应无法污染新状态。探测计入每批10秒总截止时间，截止后不再发起事件POST。

每条事件在首次尝试提交前固定协议及完整发送快照；网络重试、能力后来升级/降级和HTTP401换采集凭据都不改变同一 `event_id` 的载荷。一个批次可能同时包含先前失败的原协议事件和后来创建的扩展协议事件，服务端应逐条识别。元数据和时间不会在重试时重新生成。自动上下文与能力协商需要 `lgame-api@1.11.0` 及支持扩展协议的独立采集服务；原有游戏API无需升级此协议。
