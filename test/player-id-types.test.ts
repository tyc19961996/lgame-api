import type { OpenIdResponseData } from '../src/types.js';
const legacy: OpenIdResponseData = { open_id: 'platform-player', token: 'signed-token' };
const fresh: OpenIdResponseData = { ...legacy, user_id: 'User7K3P9X2DQ6WR' };
const optional: string | undefined = fresh.user_id;
void optional;
import { LGameAPI } from '../src/index.js';
const userId: string = LGameAPI.userId;
void userId;
// @ts-expect-error 用户编号是只读属性，必须来自登录会话。
LGameAPI.userId = 'User7K3P9X2DQ6WR';