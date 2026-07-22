# 支付宝游戏中心事件上报 - 接入文档

## 概述

该模块只支持支付宝平台（`ali`）。用户在游戏内完成事件后，前端调用 `LGameAPI.submitGamecenterEvent()` 上报，服务端调用支付宝开放平台接口 `alipay.user.gamecenter.event.submit` 将事件实时同步给游戏中心。

对应支付宝文档：<https://opendocs.alipay.com/mini-game/53941c20_alipay.user.gamecenter.event.submit>

`FindWordGame` 只是示例 `game_key`，可以替换成后台 `game_config.game_key` 中配置的任意游戏标识。

---

## 1. 前置条件

1. 事件需先在支付宝处创建（申请事件接入时创建，拿到 `event_id`）。
2. `platform_info` 中已配置支付宝小程序：

| 字段 | 示例 | 说明 |
|------|------|------|
| `platform` | `ali` | 平台固定为 `ali` |
| `appid` | `202100xxxx` | 支付宝小程序 AppID |
| `secret_key` | `-----BEGIN PRIVATE KEY-----...` | 应用私钥，用于 RSA2 签名调用支付宝网关 |

3. 用户已通过 `LGameAPI.login()` 登录（服务端从 JWT 中取 `open_id`，前端无需传）。

---

## 2. 前端调用

```typescript
import { LGameAPI } from 'lgame-api';

// 登录后调用
const res = await LGameAPI.submitGamecenterEvent({
  game_key: 'FindWordGame',
  event_id: 'frt_jjjd_game_signin',          // 支付宝处创建的事件 id
  event_finish_channel: 'gamecenter',        // 启动参数中的 channel，取不到可不传（默认 other）
  // event_finish_date: '2026-07-22 12:00:00', // 可选，默认服务端当前时间
  // out_biz_no: 'your-unique-no',             // 可选，幂等流水号，默认服务端生成
  // property_map: [{ key: 'orderId', value: '123456' }], // 可选，事件属性
});

if (res.code === 0 && res.data) {
  console.log('上报成功, out_biz_no =', res.data.out_biz_no);
}
```

### 参数说明

| 参数 | 必填 | 说明 |
|------|------|------|
| `game_key` | 是 | 游戏标识 |
| `event_id` | 是 | 支付宝处创建的事件 id |
| `event_finish_date` | 否 | 事件完成时间 `yyyy-MM-dd HH:mm:ss`，默认服务端当前时间 |
| `event_finish_channel` | 否 | 完成渠道。取小程序启动参数的 `channel` 字段，取不到默认 `other` |
| `out_biz_no` | 否 | 全局唯一流水号（幂等用），默认服务端自动生成 32 位十六进制串 |
| `property_map` | 否 | 事件属性列表 `[{ key, value }]`，key 为属性 id |

### 获取启动渠道 channel

启动参数链接示例：`alipays://platformapi/startapp?appId=202100xxxx&query=channel%3Dgamecenter`

```typescript
const options = my.getLaunchOptionsSync();
const channel = options?.query?.channel || 'other';
```

---

## 3. 服务端接口

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| POST | `/api/v1/gamecenter/event/submit` | JWT | 上报事件，服务端转发支付宝网关 |

成功响应：

```json
{
  "code": 0,
  "message": "Success",
  "data": {
    "submitted": true,
    "out_biz_no": "397a679f41dd0fc38d217a082af31f4e"
  }
}
```

失败时 `code` 为业务错误码；支付宝网关返回非 `10000` 时服务端返回 500，`message` 中包含支付宝错误信息（如 `EVENT_ID_IS_INVALID`）。

### 常见支付宝业务错误码

| 错误码 | 说明 |
|--------|------|
| `EVENT_ID_IS_INVALID` | eventId 无效，检查是否已在支付宝处创建 |
| `USER_ID_IS_INVALID` | openId 无效 |
| `SYSTEM_ERROR` | 支付宝系统繁忙，可用相同 `out_biz_no` 重试（幂等） |
