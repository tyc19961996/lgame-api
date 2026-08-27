# 排行榜模块 - 前端接入文档

## 概述

排行榜服务支持多游戏、多排行榜类型、多时间周期。所有接口需要 JWT 令牌（通过登录接口获取）。

**前置条件：** 先调用 `LGameAPI.login()` 获取 token。

**平台隔离：** 排行榜数据按平台（微信/快手/字节/开发模式）自动隔离，同一游戏在不同平台有独立的排行。`platform` 由 JWT 令牌自动携带，前端无需额外传递。

---

## 1. 提交分数

### 接口信息

| 项目 | 值 |
|------|-----|
| URL | `POST /api/v1/leaderboard/submit` |
| 认证 | JWT（body 中传 token） |
| 说明 | 提交分数，服务端自动与历史最佳比较，仅保留更优成绩 |

### 请求参数（Body - JSON）

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| game_key | string | 是 | 游戏标识，如 `game_2048` |
| leaderboard_key | string | 是 | 排行榜标识，如 `high_score_daily` |
| score | number | 是 | 分数（整数），必须为有效数字 |
| player_name | string | 否 | 玩家昵称，有则更新 |
| avatar_url | string | 否 | 头像 URL，有则更新 |
| extra_data | object | 否 | 扩展数据，如 `{ "level": 10, "combo": 5 }` |
| token | string | 是 | JWT 令牌（自动添加，前端无需手动传） |

### 请求示例

```json
{
  "game_key": "game_2048",
  "leaderboard_key": "high_score_daily",
  "score": 9999,
  "player_name": "小明",
  "avatar_url": "https://xxx/avatar.png",
  "extra_data": { "level": 10 },
  "token": "eyJhbGci..."
}
```

### 成功响应

```json
{
  "code": 0,
  "message": "Success",
  "data": {
    "updated": true,
    "score": 9999,
    "rank": 15
  },
  "timestamp": "1760000000000"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| data.updated | boolean | 本次是否刷新了纪录（`true` = 新纪录更优，已更新） |
| data.score | number | 当前最佳分数 |
| data.rank | number \| null | 当前排名（无记录时为 null） |

### 更新规则

| 排行榜排序方式 | 更新条件 |
|--------------|---------|
| DESC（分数类，越大越好） | 新分数 > 旧分数时更新 |
| ASC（时间类，越小越好） | 新分数 < 旧分数时更新 |

---

## 2. 获取排行榜 Top N

### 接口信息

| 项目 | 值 |
|------|-----|
| URL | `GET /api/v1/leaderboard/top` |
| 认证 | JWT（query 中传 token） |
| 说明 | 获取当前周期的 Top N 排行榜 |

### 请求参数（Query）

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| game_key | string | 是 | — | 游戏标识 |
| leaderboard_key | string | 是 | — | 排行榜标识 |
| limit | number | 否 | 50 | 返回数量，最大 200 |
| offset | number | 否 | 0 | 偏移量，用于翻页 |
| mockPlayers | string | 否 | — | 假玩家数据 JSON 数组，最多 50 条。如 `[{"playerName":"小明","score":8500}]` |
| token | string | 是 | — | JWT 令牌 |

### 请求示例

```
GET /api/v1/leaderboard/top?game_key=game_2048&leaderboard_key=high_score_daily&limit=50&token=eyJhbGci...
```

### 成功响应

```json
{
  "code": 0,
  "message": "Success",
  "data": {
    "game_key": "game_2048",
    "leaderboard_key": "high_score_daily",
    "leaderboard_name": "每日最高分",
    "period_key": "2026-04-16",
    "total": 1523,
    "list": [
      {
        "rank": 1,
        "openid": "oAAA",
        "player_name": "第一名",
        "avatar_url": "https://xxx/1.png",
        "score": 99999,
        "extra_data": null
      },
      {
        "rank": 2,
        "openid": "oBBB",
        "player_name": "第二名",
        "avatar_url": "https://xxx/2.png",
        "score": 88888,
        "extra_data": { "level": 20 }
      }
    ]
  },
  "timestamp": "1760000000000"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| data.leaderboard_name | string | 排行榜显示名称 |
| data.period_key | string | 当前周期标识（如 `2026-04-16`） |
| data.total | number | 榜上总人数 |
| data.list[].rank | number | 排名序号 |
| data.list[].openid | string | 玩家 openid |
| data.list[].player_name | string | 玩家昵称 |
| data.list[].avatar_url | string | 头像 URL |
| data.list[].score | number | 分数 |
| data.list[].extra_data | object \| null | 扩展数据 |
| data.list[].is_mock | boolean | 是否为假玩家（仅传了 mockPlayers 时才有此字段） |

---

## 3. 获取我的排名

### 接口信息

| 项目 | 值 |
|------|-----|
| URL | `GET /api/v1/leaderboard/myRank` |
| 认证 | JWT |
| 说明 | 获取当前玩家在指定排行榜的排名 |

### 请求参数（Query）

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| game_key | string | 是 | 游戏标识 |
| leaderboard_key | string | 是 | 排行榜标识 |
| mockPlayers | string | 否 | 假玩家数据 JSON 数组，最多 50 条 |
| token | string | 是 | JWT 令牌 |

### 请求示例

```
GET /api/v1/leaderboard/myRank?game_key=game_2048&leaderboard_key=high_score_daily&token=eyJhbGci...
```

### 成功响应

**已上榜：**

```json
{
  "code": 0,
  "message": "Success",
  "data": {
    "rank": 15,
    "score": 9999,
    "player_name": "小明",
    "avatar_url": "https://xxx/avatar.png",
    "extra_data": null,
    "total": 1523
  },
  "timestamp": "1760000000000"
}
```

**未上榜：**

```json
{
  "code": 0,
  "message": "Success",
  "data": {
    "rank": null,
    "score": null,
    "player_name": null,
    "avatar_url": null,
    "extra_data": null,
    "total": 1523
  },
  "timestamp": "1760000000000"
}
```

---

## 4. 获取附近排名

### 接口信息

| 项目 | 值 |
|------|-----|
| URL | `GET /api/v1/leaderboard/aroundMe` |
| 认证 | JWT |
| 说明 | 获取当前玩家前后各 N 名的排名，适合展示"附近的对手" |

### 请求参数（Query）

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| game_key | string | 是 | — | 游戏标识 |
| leaderboard_key | string | 是 | — | 排行榜标识 |
| limit | number | 否 | 5 | 前后各取几名，最大 20 |
| mockPlayers | string | 否 | — | 假玩家数据 JSON 数组，最多 50 条 |
| token | string | 是 | — | JWT 令牌 |

### 请求示例

```
GET /api/v1/leaderboard/aroundMe?game_key=game_2048&leaderboard_key=high_score_daily&limit=5&token=eyJhbGci...
```

### 成功响应

```json
{
  "code": 0,
  "message": "Success",
  "data": {
    "my_rank": 15,
    "my_score": 9999,
    "list": [
      { "rank": 12, "openid": "oAAA", "player_name": "张三", "avatar_url": "", "score": 10200, "extra_data": null },
      { "rank": 13, "openid": "oBBB", "player_name": "李四", "avatar_url": "", "score": 10100, "extra_data": null },
      { "rank": 14, "openid": "oCCC", "player_name": "王五", "avatar_url": "", "score": 10050, "extra_data": null },
      { "rank": 15, "openid": "oXXX", "player_name": "我",   "avatar_url": "", "score": 9999,  "extra_data": null, "is_me": true },
      { "rank": 16, "openid": "oDDD", "player_name": "赵六", "avatar_url": "", "score": 9800,  "extra_data": null }
    ]
  },
  "timestamp": "1760000000000"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| data.my_rank | number \| null | 我的排名（未上榜为 null） |
| data.my_score | number \| null | 我的分数（未上榜为 null） |
| data.list[].is_me | boolean | 是否为当前玩家（仅 aroundMe 接口有此字段） |

---

## 5. 假玩家数据（mockPlayers）

### 功能说明

排行榜的 4 个查询接口（topList、myRank、aroundMe、percentile）支持传入假玩家数据，假数据会与真实数据合并排序，使排行榜看起来更热闹。**数据不写入数据库，仅在内存中混入。**

### 使用方式

在调用接口时传入 `mockPlayers` 数组即可：

```typescript
const mockPlayers = [
  { playerName: '小明', score: 8500, avatarUrl: 'https://xxx/1.png' },
  { playerName: '大力', score: 6200 },
  { playerName: '小红', score: 7800, avatarUrl: 'https://xxx/3.png' },
];

// topList — 假数据与真实数据一起排序
const topRes = await LGameAPI.getTopList('game_2048', 'high_score_daily', 20, 0, mockPlayers);

// myRank — 排名会包含假玩家
const rankRes = await LGameAPI.getMyRank('game_2048', 'high_score_daily', mockPlayers);

// aroundMe — 附近排名包含假玩家
const aroundRes = await LGameAPI.getAroundMe('game_2048', 'high_score_daily', 5, mockPlayers);

// percentile — 百分比计算包含假玩家
const pctRes = await LGameAPI.getPercentile('game_2048', 'high_score_daily', mockPlayers);
```

### MockPlayer 类型

```typescript
interface MockPlayer {
  playerName: string;   // 必填，假玩家昵称
  avatarUrl?: string;   // 可选，头像 URL
  score: number;        // 必填，分数
}
```

### 行为说明

| 项目 | 说明 |
|------|------|
| 排序 | 假数据与真实数据统一排序（DESC 分数大的在前，ASC 分数小的在前） |
| 标识 | 假玩家条目带 `is_mock: true`，真实玩家为 `is_mock: false` |
| 排名 | myRank、percentile 的排名和 total 会把假玩家算进去 |
| 限制 | 最多传入 50 条假数据 |
| 影响 | 不传 mockPlayers 或传空数组时，完全走原逻辑，零影响 |

---

## 6. 错误码说明

所有接口共用以下错误码：

| code | 说明 | 处理建议 |
|------|------|---------|
| 0 | 成功 | — |
| 400 | 参数错误 | 检查参数格式（如 score 必须为数字） |
| 401 | 缺少必填参数 | 检查是否遗漏 game_key、leaderboard_key 等 |
| 402 | token 无效或已过期 | 重新调用 `login()` 获取新 token |
| 404 | 排行榜配置不存在 | 检查 game_key 和 leaderboard_key 是否正确 |
| 500 | 服务器错误 | 联系后端排查 |

---

## 7. 前端调用示例

### 完整流程（TypeScript）

```typescript
import { LGameAPI } from 'lgame-api';

// === 初始化 ===
LGameAPI.appid = 'wx1234567890abcdef';

// === 登录 ===
const loginRes = await LGameAPI.login();
if (loginRes.code !== 0) {
  console.error('登录失败:', loginRes.message);
  return;
}

// === 提交分数 ===
const submitRes = await LGameAPI.submitScore({
  game_key: 'game_2048',
  leaderboard_key: 'high_score_daily',
  score: 9999,
  player_name: '小明',
  avatar_url: 'https://xxx/avatar.png',
});

if (submitRes.data.updated) {
  console.log(`新纪录！当前排名: 第${submitRes.data.rank}名`);
}

// === 查看排行榜 ===
const topRes = await LGameAPI.getTopList('game_2048', 'high_score_daily', 20);
topRes.data.list.forEach(item => {
  console.log(`第${item.rank}名: ${item.player_name} - ${item.score}分`);
});

// === 我的排名 ===
const myRankRes = await LGameAPI.getMyRank('game_2048', 'high_score_daily');
console.log(`我的排名: ${myRankRes.data.rank}/${myRankRes.data.total}`);

// === 附近的对手 ===
const aroundRes = await LGameAPI.getAroundMe('game_2048', 'high_score_daily', 5);
aroundRes.data.list.forEach(item => {
  const tag = item.is_me ? ' ← 我' : '';
  const mockTag = item.is_mock ? ' (假)' : '';
  console.log(`第${item.rank}名: ${item.player_name} - ${item.score}分${tag}${mockTag}`);
});

// === 使用假玩家数据（让排行榜更热闹） ===
const mockPlayers = [
  { playerName: '小明', score: 8500 },
  { playerName: '大力', score: 6200 },
  { playerName: '小红', score: 7800 },
];
const topWithMock = await LGameAPI.getTopList('game_2048', 'high_score_daily', 20, 0, mockPlayers);
topWithMock.data.list.forEach(item => {
  const tag = item.is_mock ? ' [假]' : '';
  console.log(`第${item.rank}名: ${item.player_name} - ${item.score}分${tag}`);
});
```

### Token 过期自动处理

`LGameAPI` 内置了 token 过期自动重试机制，**上层无需手动处理**：

```
任意业务接口返回 code=402
  → 自动调用 platformLogin() 获取新 code
  → 自动重新调用 /getOpenId 换取新 JWT
  → 用新 token 自动重发原始请求
  → 整个过程对上层透明
```

```typescript
// 直接调用即可，token 过期会自动处理
const res = await LGameAPI.getTopList('game_2048', 'high_score_daily');
// 如果中途 token 过期，内部已自动重试，res 就是重试后的结果
```
