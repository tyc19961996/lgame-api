# 邀请任务 - 前端接入文档

## 概述

邀请任务用于“邀请 N 名玩家并让被邀请人完成指定条件”后给邀请人发放奖励。客户端只负责分享参数、接受邀请、上报基础事件和展示进度；是否满足任务条件由服务端根据后台配置判断。

**前置条件：** 先调用 `LGameAPI.login()` 获取 token。

---

## 1. 邀请人创建分享码

```typescript
import { LGameAPI } from 'lgame-api';

LGameAPI.appid = 'wx1234567890abcdef';
await LGameAPI.login();

const inviteRes = await LGameAPI.createInvite({
  game_key: 'FindWordGame',
  task_key: 'invite_2_pass_level_10'
});

const shareQuery = inviteRes.data.share_query;
```

平台分享时把 `shareQuery` 放到分享参数中：

```typescript
// 示例，具体字段按小游戏平台 API 调整
{
  title: '来一起玩',
  query: shareQuery
}
```

---

## 2. 被邀请人接受邀请

被邀请人启动小游戏时，从平台启动参数读取 `invite_code`。登录后调用：

```typescript
await LGameAPI.login();

if (inviteCodeFromLaunchOptions) {
  const acceptRes = await LGameAPI.acceptInvite('FindWordGame', inviteCodeFromLaunchOptions);

  if (acceptRes.data.accepted) {
    console.log('接受邀请成功');
  } else if (acceptRes.data.reason === 'already_accepted') {
    console.log('该任务已接受过其他邀请');
  }
}
```

同一个 `game_key + task_key` 下，一个被邀请人只归属第一次接受的邀请人。

---

## 3. 上报玩家事件

玩家完成某个行为时上报基础事件，不要上报“任务完成”。

```typescript
await LGameAPI.reportPlayerEvent({
  game_key: 'FindWordGame',
  event_key: 'level_pass',
  event_data: {
    level_id: 10
  }
});
```

服务端会根据后台任务配置判断事件是否满足条件。例如后台条件为：

```json
{
  "event_key": "level_pass",
  "rules": [
    { "field": "level_id", "op": "gte", "value": 10 }
  ]
}
```

---

## 4. 查询进度和领奖

```typescript
const progressRes = await LGameAPI.getInviteProgress('FindWordGame', 'invite_2_pass_level_10');
const progress = progressRes.data;

if (progress.completed && !progress.reward_claimed) {
  const claimRes = await LGameAPI.claimInviteReward('FindWordGame', 'invite_2_pass_level_10');
  console.log('领取奖励', claimRes.data.reward);
}
```

---

## 5. 推荐接入顺序

1. 游戏启动时读取 `invite_code`。
2. 调用 `LGameAPI.login()`。
3. 如果有 `invite_code`，调用 `acceptInvite()`。
4. 邀请活动页调用 `createInvite()` 获取分享参数。
5. 玩家完成行为时调用 `reportPlayerEvent()`。
6. 活动页调用 `getInviteProgress()` 刷新进度。
7. 达成后调用 `claimInviteReward()`。
