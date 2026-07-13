# 支付宝广告奖励 - 接入文档

## 概述

该模块只支持支付宝平台（`ali`）。支付宝广告后台在用户完成任务后回调服务端，服务端解密回调并记录奖励；前端登录后查询是否有未领取奖励，再调用领取接口。

`FindWordGame` 只是示例 `game_key`，可以替换成后台 `game_config.game_key` 中配置的任意游戏标识。

---

## 1. 后台回调地址

支付宝广告后台填写：

```text
https://hyxx.yiiwan.cn/api/v1/ali-ad/reward/callback?game_key=FindWordGame
```

如果接入其他游戏，把 `FindWordGame` 替换为对应 `game_key`：

```text
https://hyxx.yiiwan.cn/api/v1/ali-ad/reward/callback?game_key=你的game_key
```

回调 GET 校验和 POST 正式回调使用同一个地址。服务端成功响应固定为：

```json
{ "code": 0, "message": "OK" }
```

---

## 2. 服务端配置

### 环境变量

| 名称 | 必填 | 说明 |
|------|------|------|
| `ALI_AD_CALLBACK_AES_KEY` | 是 | 支付宝广告回调管理后台配置的 TOKEN，Base64 AES 密钥 |
| `JWT_SECRET` | 是 | 登录签发 JWT 使用 |

### 平台配置

`platform_info` 中需要配置支付宝小程序：

| 字段 | 示例 | 说明 |
|------|------|------|
| `platform` | `ali` | 平台固定为 `ali` |
| `appid` | `202100xxxx` | 支付宝小程序 AppID |
| `secret_key` | `-----BEGIN PRIVATE KEY-----...` | 应用私钥，用于 RSA2 签名换取 openid；字段需为 `TEXT`，不能使用旧的 `VARCHAR(255)` |

### 建表

执行：

```sql
source sql/init_ali_ad_reward.sql;
```

---

## 3. 支付宝回调数据要求

前端拉起广告任务时，需要把玩家 openid 放进 `extendInfo.openid`。服务端只使用 `extendInfo.openid` 关联玩家，不会用支付宝 `userId` 兜底。

回调必填字段：

| 字段 | 说明 |
|------|------|
| `userId` | 支付宝用户 ID，仅记录 |
| `bizId` | 支付宝奖励业务唯一 ID，用于幂等 |
| `spaceCode` | 广告位编码 |
| `rewardNumber` | 奖励数量 |
| `extendInfo.openid` | 当前游戏登录用户 openid |

同一个 `bizId` 重复回调只记录一次。

---

## 4. 前端查询是否有未领取奖励

**前置条件：** 支付宝小游戏环境中先调用 `LGameAPI.login()`，SDK 会自动使用 `my.getAuthCode({ scopes: 'auth_base' })` 登录并换取 JWT。

```typescript
import { LGameAPI } from './LGameApi';

LGameAPI.appid = '202100xxxx';
await LGameAPI.login();

const pendingRes = await LGameAPI.getAliAdRewardPending('FindWordGame');
if (pendingRes.code === 0 && pendingRes.data.has_unclaimed) {
  console.log('未领取奖励数量', pendingRes.data.count);
}
```

接口：

```text
GET /api/v1/ali-ad/reward/pending?game_key=FindWordGame&token=JWT
```

响应：

```json
{
  "code": 0,
  "message": "Success",
  "data": {
    "has_unclaimed": true,
    "count": 1,
    "rewards": [
      {
        "biz_id": "202607100001",
        "reward_number": "10",
        "space_code": "space_001",
        "claimed": false
      }
    ]
  },
  "timestamp": "2026-07-10T12:00:00.000Z"
}
```

---

## 5. 前端领取奖励

```typescript
const claimRes = await LGameAPI.claimAliAdReward('FindWordGame');
if (claimRes.code === 0 && claimRes.data.claimed_count > 0) {
  console.log('已领取奖励', claimRes.data.rewards);
}
```

接口：

```text
POST /api/v1/ali-ad/reward/claim
```

请求体：

```json
{
  "game_key": "FindWordGame",
  "token": "JWT"
}
```

该接口会一次性领取当前玩家在该 `game_key` 下所有未领取的支付宝广告奖励。

---

## 6. 错误码说明

| code | 说明 |
|------|------|
| 400 | 非支付宝平台调用，或参数格式错误 |
| 401 | 缺少必填参数 |
| 402 | JWT 无效或已过期 |
| 404 | `game_key` 不存在 |
| 500 | 服务端配置或系统错误 |
