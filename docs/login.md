# 登录模块 - 前端接入文档

## 概述

小游戏启动时调用平台登录接口获取临时 `code`，再用 `code` 换取 `openid` 和 JWT 令牌。后续所有接口需携带 JWT 令牌。

## 登录流程

```
小游戏启动
  │
  ├─ wx.login() / ks.login() / tt.login() / my.getAuthCode() / bl.login()
  │    → 获取 code（一次性，5分钟有效）
  │
  ├─ GET /api/v1/getOpenId?appid=xxx&platform=wechat&code=yyy
  │    → 服务端用 code + secret 向平台换 openid
  │    → 签发 JWT 令牌（2小时有效）
  │
  └─ 返回 { open_id, token }
       → 保存 token，后续接口使用
```

---

## 接口详情

### 获取 OpenID（登录）

| 项目 | 值 |
|------|-----|
| URL | `GET /api/v1/getOpenId` |
| 认证 | 无（公开接口） |
| 说明 | 用平台 code 换取 openid，同时签发 JWT 令牌 |

**请求参数（Query）：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| appid | string | 是 | 小程序 AppID |
| platform | string | 是 | 平台标识：`wechat` / `ks` / `bytedance` / `ali` / `bilibili` |
| code | string | 是 | 平台 login() 返回的登录凭证 |

> `platform` 支持别名自动转换：`wx`/`微信` → `wechat`，`快手` → `ks`，`抖音`/`tt` → `bytedance`，`支付宝`/`alipay` → `ali`，`B站`/`bl` → `bilibili`

**成功响应：**

```json
{
  "code": 0,
  "message": "Success",
  "data": {
    "open_id": "oXXXX_xxxxxxxxxxxxxxxx",
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  },
  "timestamp": "1760000000000"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| data.open_id | string | 玩家在该平台的唯一标识 |
| data.token | string | JWT 令牌，有效期 2 小时，用于后续所有业务接口 |

**错误响应：**

```json
{
  "code": 401,
  "message": "缺少 platform、appid 或 code 参数",
  "data": null
}
```

---

## 前端调用示例

### TypeScript（LGameAPI 封装）

```typescript
import { LGameAPI } from 'lgame-api';

// 1. 初始化（游戏启动时调用一次，baseUrl 必填）
LGameAPI.init({
  baseUrl: 'https://your-server.com/api/v1/',
  appid: 'wx1234567890abcdef',
});

// 2. 登录
const res = await LGameAPI.login();
if (res.code === 0) {
  console.log('openid:', res.data.open_id);
  console.log('已登录:', LGameAPI.isLoggedIn); // true
} else {
  console.error('登录失败:', res.message);
}
```

支付宝小游戏同样使用 `LGameAPI.login()`，SDK 内部会调用 `my.getAuthCode({ scopes: 'auth_base' })`：

```typescript
LGameAPI.init({ baseUrl: 'https://your-server.com/api/v1/', appid: '202100xxxx' });
const res = await LGameAPI.login();
```

哔哩哔哩小游戏同样使用 `LGameAPI.login()`，SDK 内部会调用 `bl.login()`。当前封装按非虚拟小游戏处理，不传 `vAppId`：

```typescript
LGameAPI.init({ baseUrl: 'https://your-server.com/api/v1/', appid: 'bili_xxxx' });
const res = await LGameAPI.login();
```

平台识别与登录逻辑（`isDevMode` / `getPlatform` / `platformLogin`）可在 `init` 时按项目重写，详见 [README](../README.md)。

### 原生请求

```javascript
// 微信小游戏
wx.login({
  success(loginRes) {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', `https://your-domain.com/api/v1/getOpenId?appid=wx123&platform=wechat&code=${loginRes.code}`);
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4) {
        const res = JSON.parse(xhr.responseText);
        const openId = res.data.open_id;
        const token = res.data.token;
        // 保存 token，后续请求携带
      }
    };
    xhr.send();
  }
});
```

---

## 注意事项

| 事项 | 说明 |
|------|------|
| **code 是一次性的** | 平台 code 只能使用一次，5 分钟内有效，用完即废 |
| **JWT 有效期 2 小时** | 过期后需重新调用 `login()` 获取新令牌 |
| **token 传递方式** | GET 请求放 `query.token`，POST 请求放 `body.token` |
| **appid 不可为空** | 必须与 `platform_info` 表中配置的 appid 一致 |
