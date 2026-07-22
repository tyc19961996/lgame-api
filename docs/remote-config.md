# 远程配置 - 前端接入文档

## 概述

远程配置用于按游戏、平台、版本范围、时间窗口和优先级下发开关配置。小游戏前端只需要传 `game_key` 和当前版本号，平台由 JWT 自动携带。

**前置条件：** 先调用 `LGameAPI.login()` 获取 token。

**平台隔离：** 平台从登录后的 JWT 中读取，前端无需传 `platform`。

---

## 1. 获取远程配置

### 接口信息

| 项目 | 值 |
|------|-----|
| URL | `GET /api/v1/remote-config` |
| 认证 | JWT（query 中传 token） |
| 说明 | 获取后台合并后的远程配置 |

### 请求参数（Query）

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| game_key | string | 是 | 游戏标识，如 `game_2048` |
| version | string | 是 | 当前客户端版本号，如 `1.2.3` |
| token | string | 是 | JWT 令牌（自动添加，前端无需手动传） |

### 请求示例

```text
GET /api/v1/remote-config?game_key=game_2048&version=1.2.3&token=eyJhbGci...
```

### 成功响应

```json
{
  "code": 0,
  "message": "Success",
  "data": {
    "game_key": "game_2048",
    "platform": "wechat",
    "version": "1.2.3",
    "config": {
      "activity": {
        "visible": true,
        "title": "限时活动"
      },
      "feature": {
        "new_shop": false
      }
    }
  },
  "timestamp": "2026-06-03T12:00:00.000Z"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| data.game_key | string | 游戏标识 |
| data.platform | string | 当前 JWT 中的平台 |
| data.version | string | 规范化后的版本号 |
| data.config | object | 后台合并后的配置对象 |

---

## 2. 前端调用示例

### 基础用法

```typescript
import { LGameAPI } from 'lgame-api';

LGameAPI.appid = 'wx1234567890abcdef';
await LGameAPI.login();

const res = await LGameAPI.getRemoteConfig('game_2048', '1.2.3');

if (res.code === 0) {
  const config = res.data.config;

  if (config.activity?.visible) {
    console.log('显示活动入口');
  }

  if (config.feature?.new_shop) {
    console.log('开启新版商店');
  }
}
```

### 带类型用法

```typescript
interface GameRemoteConfig {
  activity?: {
    visible?: boolean;
    title?: string;
    start_at?: string;
    end_at?: string;
  };
  feature?: {
    new_shop?: boolean;
  };
}

const res = await LGameAPI.getRemoteConfig<GameRemoteConfig>('game_2048', '1.2.3');
const config = res.data.config;

if (config.activity?.visible) {
  // 显示活动入口
}
```

### 建议封装

```typescript
let remoteConfig: Record<string, any> = {};

export async function initRemoteConfig(gameKey: string, version: string) {
  const res = await LGameAPI.getRemoteConfig(gameKey, version);
  if (res.code === 0) {
    remoteConfig = res.data.config || {};
  }
  return remoteConfig;
}

export function isFeatureEnabled(path: string): boolean {
  const value = path.split('.').reduce<any>((obj, key) => obj?.[key], remoteConfig);
  return value === true;
}

// 使用
await initRemoteConfig('game_2048', '1.2.3');
if (isFeatureEnabled('activity.visible')) {
  // 显示活动入口
}
```

---

## 3. 错误码说明

| code | 说明 | 处理建议 |
|------|------|---------|
| 0 | 成功 | 使用 `data.config` |
| 400 | 参数错误 | 检查版本号格式或平台是否支持 |
| 401 | 缺少必填参数 | 检查是否传入 `game_key`、`version` |
| 402 | token 无效或已过期 | SDK 会自动静默登录并重试 |
| 404 | 游戏不存在或平台配置不存在 | 检查后台 `game_key` 和游戏状态 |
| 500 | 服务器错误 | 联系后端排查远程配置内容 |

---

## 4. 配置合并规则

- 后台先筛选同 `game_key`、同平台或 `all` 平台的启用规则。
- 再按时间窗口和版本范围过滤。
- 多条规则按 `priority` 从小到大、`id` 从小到大合并。
- JSON 对象会递归合并；数组、字符串、数字、布尔值和 `null` 会整体覆盖。
- 没有命中规则时，`config` 返回空对象 `{}`。
