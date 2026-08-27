# 服务端时间戳

## 接口说明

| 项目 | 内容 |
|------|------|
| URL | `GET /api/v1/timestamp` |
| 鉴权 | 无需登录、token 或签名 |
| 参数 | 无 |
| 返回值 | `timestamp` 为 Unix 毫秒时间戳字符串 |

## 直接调用

```typescript
const response = await LGameAPI.getTimestamp();

console.log(response.timestamp); // "1760000000000"
```

服务端返回：

```json
{
  "code": 0,
  "message": "Success",
  "data": null,
  "timestamp": "1760000000000"
}
```

`timestamp` 是字符串类型的 Unix 毫秒时间戳，可通过 `Number(response.timestamp)` 转换为数字。
