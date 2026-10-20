# lgame-api

小游戏通用服务端 API 客户端 SDK。支持微信 / 支付宝 / 抖音 / 快手 / Bilibili / OPPO 小游戏平台及 HarmonyOS NEXT native 适配，提供自定义打点、服务端时间、登录、排行榜、游戏存档、远程配置、邀请任务、支付宝广告奖励与游戏中心事件上报等能力。

当前源码版本为1.11.0，已构建本地安装包；尚未提交、推送或执行npm发布。版本边界与验证结果见[源码交接记录](./docs/analytics-release-status.md)。

## 安装

```bash
# 从 npm 安装
npm install lgame-api

# 或从 GitHub 安装（替换为实际仓库地址）
npm install github:tyc19961996/lgame-api#main
```

## 快速开始

SDK 不内置服务端地址，使用前必须先初始化：

```typescript
import { LGameAPI } from 'lgame-api';

LGameAPI.init({
  baseUrl: 'https://your-server.com/api/v1/', // 必填：你的服务端地址
  // analyticsBaseUrl: 'https://analytics.example.com/', // 可选：启用独立采集直传
  app_version: '1.0.0', // 可选：游戏版本，供自动打点上下文使用
  os_name: 'Android', // 可选：由调用方提供的系统名称
  device_model: '示例机型', // 可选：由调用方提供，SDK不读取设备型号
  appid: '你的小程序AppID',                     // 可选：等同于 LGameAPI.appid = 'xxx'
});

const loginRes = await LGameAPI.login();
const userNumber = LGameAPI.userId; // string，供设置界面展示和复制
```

登录返回类型包含 `open_id: string`、`token: string`、`user_id?: string`。可选字段兼容旧服务端，登录后也可通过只读属性 `LGameAPI.userId` 直接读取；未登录、清除会话或服务端未返回有效编号时为空字符串。内部编号不改变已有业务请求；SDK 无需将其传给存档、榜单等接口。

## 按项目重写平台适配

`isDevMode` / `getPlatform` / `platformLogin` 默认根据全局对象（`wx` / `my` / `tt` / `ks` / `bl` / `qg`）自动识别平台并调用对应登录接口。如果某个项目有特殊逻辑（比如固定平台、自定义登录流程），可以在 `init` 时重写，不传则使用默认实现：

```typescript
LGameAPI.init({
  baseUrl: 'https://your-server.com/api/v1/',
  appid: '202100xxxx',

  // 以下均可选，按需重写
  getPlatform: () => 'ali',                    // 固定为支付宝平台
  isDevMode: () => false,                      // 永不进入开发模式
  platformLogin: () => new Promise((resolve, reject) => {
    my.getAuthCode({
      scopes: 'auth_user',                     // 例如改用 auth_user 授权
      success: (res) => resolve({ code: res.authCode }),
      fail: reject,
    });
  }),
});
```

`platformLogin` 的约定：resolve 的对象需包含 `code` 字段（登录凭证），服务端用它换取 openid。OPPO 平台的 `qg.login()` 返回 `res.data.token`，SDK 会把它作为登录凭证发送给服务端。

## 功能文档

各模块的详细接入文档见 [docs/](./docs)：

- [自定义打点、自动上下文、能力协商与网络恢复（1.11.0）](./docs/analytics.md)
- [服务端时间戳](./docs/timestamp.md)
- [登录](./docs/login.md)
- [HarmonyOS NEXT 登录与会话隔离（1.8.0）](./docs/harmony-login.md)
- [排行榜](./docs/leaderboard.md)
- [游戏存档](./docs/gamedata.md)
- [远程配置](./docs/remote-config.md)
- [邀请任务](./docs/invite-task.md)
- [支付宝广告奖励](./docs/ali-ad-reward.md)
- [支付宝游戏中心事件上报](./docs/gamecenter-event.md)

## 开发与发布

```bash
npm install        # 安装依赖
npm run build      # 编译到 dist/
npm test           # 运行接口、会话、打点与公开类型测试
npm publish        # 发布（prepublishOnly 会自动先 build）
```

## 从旧版（复制文件方式）迁移

1. 删除项目里手动复制的 `LGameApi.ts` / `http.ts` / `config.ts` / `types.ts`
2. `npm install lgame-api`
3. 导入路径从 `'./LGameApi'` 改为 `'lgame-api'`
4. 在入口处调用 `LGameAPI.init({ baseUrl: '...' })`（旧版地址是写死在 http.ts 里的，新版必须显式传入）
