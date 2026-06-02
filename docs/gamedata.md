# 游戏数据存储 - 前端接入文档

## 概述

游戏数据存储服务为每个玩家在每个游戏中保存一份存档数据。数据为字符串（序列化后的 JSON），前端可自由定义数据结构。

**前置条件：** 先调用 `LGameAPI.login()` 获取 token。

**平台隔离：** 数据按平台（微信/快手/字节/开发模式）自动隔离，`platform` 由 JWT 自动携带，前端无需额外传递。

---

## 1. 保存游戏数据

### 接口信息

| 项目 | 值 |
|------|-----|
| URL | `POST /api/v1/gamedata/save` |
| 认证 | JWT（body 中传 token） |
| 说明 | 保存游戏数据，直接覆盖旧数据 |

### 请求参数（Body - JSON）

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| game_key | string | 是 | 游戏标识，如 `game_2048` |
| data | string | 是 | 游戏数据（序列化后的字符串，最大 64KB） |
| token | string | 是 | JWT 令牌（自动添加，前端无需手动传） |

### 请求示例

```json
{
  "game_key": "game_2048",
  "data": "{\"level\":10,\"gold\":500,\"items\":[1,2,3]}",
  "token": "eyJhbGci..."
}
```

### 成功响应

```json
{
  "code": 0,
  "message": "Success",
  "data": {
    "saved": true
  },
  "timestamp": "2026-04-20T12:00:00.000Z"
}
```

---

## 2. 加载游戏数据

### 接口信息

| 项目 | 值 |
|------|-----|
| URL | `GET /api/v1/gamedata/load` |
| 认证 | JWT（query 中传 token） |
| 说明 | 加载当前玩家在指定游戏的存档数据 |

### 请求参数（Query）

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| game_key | string | 是 | 游戏标识 |
| token | string | 是 | JWT 令牌 |

### 请求示例

```
GET /api/v1/gamedata/load?game_key=game_2048&token=eyJhbGci...
```

### 成功响应（有存档）

```json
{
  "code": 0,
  "message": "Success",
  "data": {
    "data": "{\"level\":10,\"gold\":500,\"items\":[1,2,3]}",
    "updated_at": "2026-04-20T15:30:00.000Z"
  },
  "timestamp": "2026-04-20T12:00:00.000Z"
}
```

### 成功响应（无存档）

```json
{
  "code": 0,
  "message": "Success",
  "data": {
    "data": null,
    "updated_at": null
  },
  "timestamp": "2026-04-20T12:00:00.000Z"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| data.data | string \| null | 存档数据字符串，无存档时为 null |
| data.updated_at | string \| null | 最后保存时间，无存档时为 null |

---

## 3. 错误码说明

| code | 说明 | 处理建议 |
|------|------|---------|
| 0 | 成功 | — |
| 400 | 参数错误 | 检查 data 是否为空或超过 64KB |
| 401 | 缺少必填参数 | 检查是否遗漏 game_key 或 data |
| 402 | token 无效或已过期 | 重新调用 `login()` 获取新 token |
| 404 | 游戏不存在或已禁用 | 检查 game_key 是否正确 |
| 500 | 服务器错误 | 联系后端排查 |

---

## 4. 前端调用示例

### 完整流程（TypeScript）

```typescript
import { LGameAPI } from './LGameApi';

// === 登录 ===
LGameAPI.appid = 'wx1234567890abcdef';
await LGameAPI.login();

// === 保存游戏数据 ===
const myData = {
  level: 10,
  gold: 500,
  items: [1, 2, 3],
  position: { x: 100, y: 200 }
};

const saveRes = await LGameAPI.saveGameData({
  game_key: 'game_2048',
  data: JSON.stringify(myData)
});

if (saveRes.data.saved) {
  console.log('存档成功');
}

// === 加载游戏数据 ===
const loadRes = await LGameAPI.loadGameData('game_2048');

if (loadRes.data.data) {
  const savedData = JSON.parse(loadRes.data.data);
  console.log(`读取存档: 等级=${savedData.level}, 金币=${savedData.gold}`);
  console.log(`最后保存: ${loadRes.data.updated_at}`);
} else {
  console.log('暂无存档');
}
```

### 封装为工具函数

```typescript
/** 保存游戏对象（自动序列化） */
async function saveGame(gameKey: string, obj: Record<string, any>) {
  return LGameAPI.saveGameData({
    game_key: gameKey,
    data: JSON.stringify(obj)
  });
}

/** 加载游戏对象（自动反序列化） */
async function loadGame<T = Record<string, any>>(gameKey: string): Promise<T | null> {
  const res = await LGameAPI.loadGameData(gameKey);
  if (res.data.data) {
    return JSON.parse(res.data.data) as T;
  }
  return null;
}

// 使用
await saveGame('game_2048', { level: 10 });
const data = await loadGame<{ level: number }>('game_2048');
```

### Token 过期自动处理

`LGameAPI` 内置了 token 过期自动重试机制，**上层无需手动处理**：

```typescript
// 直接调用即可，token 过期会自动重试
const res = await LGameAPI.saveGameData({ game_key: 'game_2048', data: '...' });
```
