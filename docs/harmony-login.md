# HarmonyOS NEXT 登录与会话

本功能从 `lgame-api@1.8.0` 提供，本地联调使用 `npm pack` 的 tgz；请勿假设 npm 远端已发布。

## 初始化

```typescript
import { LGameAPI, SessionChangedError } from 'lgame-api';

LGameAPI.init({
  baseUrl: 'https://your-server.example/api/v1/',
  appid: '<对应游戏的 AGC APP ID>',
  getPlatform: () => 'harmony',
  isDevMode: () => false,
  platformLogin: () => MiniHelper.common().login(),
});

const response = await LGameAPI.login();
if (response.code !== 0 || !LGameAPI.isLoggedIn) {
  throw new Error('平台登录失败，请停止进入游戏');
}
```

`MiniHelper` 由游戏框架提供，SDK 不依赖或导入框架代码。适配器必须返回 `{ success: true, code: authorizationCode, gamePlayerId: string }`；native 先完成 `unionLogin` 与 `verifyLocalPlayer`，再取得新的授权码。SDK 不直接调用华为上游服务，不保存任何服务端秘密。框架 metadata 使用公开 `app_id` 与 `client_id`，游戏业务 `appid` 使用同一游戏的真正 AGC APP ID，不填包名。

Harmony 使用 `POST /getOpenId` JSON `{ platform: 'harmony', appid, code, gamePlayerId }`。支持内部账号的服务器核验玩家后返回 `{ open_id, token, user_id }`；user_id 为内部用户编号，SDK 将该字段定义为可选字符串以兼容旧服务端。授权码只有 5 分钟有效期且只能使用一次；每个新登录或刷新任务都重新调用 `platformLogin()`，不缓存或重复发送旧 code。其他小游戏保持 GET 三参数，开发/浏览器保留 `dev/login`；显式 harmony 平台禁止用开发登录替代。

## 会话与存档隔离

- `login()` 和 402 刷新共用同一个在途登录任务。晚到的旧 token 402 可复用已刷新的同账户 token，不再次消耗授权码。
- 成功响应必须具有非空字符串 `open_id` 和 `token`，否则抛错。两者通过一次会话对象替换同步更新，不会出现混合账户凭据。
- `isLoggedIn` 表示已接受有效字段的登录响应、会话未清除、且当前 token 未收到 402。它不在本地解析或验证 JWT，也不能预测服务端撤销。402 刷新期间及失败后为 false；成功刷新恢复 true。
- `clearSession(): void` 清空会话并递增代次，使旧 native 登录、服务器登录、业务成功响应和重试结果失效。已发送请求无法撤销服务器上的写入，游戏仍需在账号事件开始时立即暂停新上传。
- 业务请求绑定发送时的账户和会话代次。A 的请求不能拿 B 的 token 重试；静默刷新遇到 B 时清除会话并抛出 `SessionChangedError`，其 `code` 固定为 `'SESSION_CHANGED'`。手动 `login()` 可接受新账户，并使旧账户请求失效。1.9.0也核对已知`user_id`，相同`open_id`但UID改变或缺失同样触发身份隔离。
- 再次调用 `init()` 也会清会话；不要在每个业务请求前反复初始化。
- 直接修改公开 `appid` 或 `devId` 会立即清会话。动态平台、开发模式或服务地址变化时，下一次读取会话或处理请求也会失效，防止相同 openId 跨应用复用凭据。

```typescript
// native 账号事件到达时，先暂停上传和切换存档逻辑，再执行清会话。
const unsubscribe = MiniGame.HarmonyAccount.onAccountChanged(() => {
  LGameAPI.clearSession();
  // 游戏保存旧账号快照，并执行自己的重启/重新登录流程。
});

try {
  await LGameAPI.saveGameData({ game_key: 'example-game', data: '{}' });
} catch (error) {
  if (error instanceof SessionChangedError || (error as { code?: string }).code === 'SESSION_CHANGED') {
    // 丢弃旧请求结果，禁止用新账号重复上传旧存档。
  } else {
    throw error;
  }
}
// 销毁游戏账号监听时调用 unsubscribe()。
```

账号切换无需主动复用上一账号的 `openId`、token 或 code。网络异常按原有 Promise 拒绝处理；刷新失败返回原请求的 402，游戏停止云端操作并引导重新登录。

## 验证边界

`npm test` 使用 mock XHR 与平台适配器验证字段转发、并发刷新、清会话和账号切换隔离，并包含 OPPO/时间戳回归和 TypeScript 构建。本地验证不等同于真实凭据、线上接口或真机验收。

官方流程：[华为账号游戏登录](https://developer.huawei.com/consumer/en/doc/harmonyos-guides/gameservice-gameplayer-huawei)、[获取用户级凭证](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/account-api-obtain-user-token)、[获取玩家标识](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/gameservice-getplayerinfo)。
