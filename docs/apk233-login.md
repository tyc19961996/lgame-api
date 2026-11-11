# 233 APK 登录与切号

从 `lgame-api@1.13.0` 开始，游戏可以通过原生框架提供的登录适配接入 233 乐园 APK。使用已支持 `233apk` 的业务服务器。内购 SDK 初始化参数为开发者后台分配的 AppKey 和 cpId。AppSecret 由业务服务器管理。

```ts
import { MiniGame } from 'cygnat-cc-framework';
import { LGameAPI } from 'lgame-api';

await MiniGame.Apk233Account.init({ appKey: '<233 内购 AppKey>', cpId: '<233 cpId>' });

LGameAPI.init({
  baseUrl: 'https://example.com/api/v1/',
  appid: '<233 内购 AppKey>',
  getPlatform: () => '233apk',
  isDevMode: () => false,
  platformLogin: () => MiniGame.MiniHelper.common().login(),
});

// 在调用 login 前按下文订阅账号事件。
const result = await LGameAPI.login();
if (result.code === 0) {
  // 使用 LGameAPI.userId 绑定本账号的存档，再恢复游戏。
}
```

游戏应先取得用户同意再初始化。SDK 从平台登录结果中读取 `success: true`、`uid` 和 `sid`，通过 HTTPS 的 POST JSON 发送到业务服务器的 `getOpenId`。HTTP 仅允许本地回环测试。将 `sid` 作为登录凭据，只在本次交换中传递。

在触发首轮登录前订阅 `MiniGame.Apk233Account.onAccountChanged`。收到 `logout` 或 `changed` 时暂停云存档写入并调用 `LGameAPI.clearSession()`。丢弃旧请求的 `SESSION_CHANGED` 结果。收到 `logout` 后回到登录界面，等待宿主的登录流程。收到 `changed` 后重新执行 `LGameAPI.login()`，绑定新的内部 `user_id` 后恢复游戏。游戏销毁时调用订阅返回的取消函数。

业务请求返回 `402` 时，游戏展示重新登录入口，由玩家发起登录。233 APK 的后台请求不会主动调用原生登录。
