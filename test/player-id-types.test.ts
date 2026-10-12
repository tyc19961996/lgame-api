import type { OpenIdResponseData } from '../src/types.js';
const legacy: OpenIdResponseData = { open_id: 'platform-player', token: 'signed-token' };
const fresh: OpenIdResponseData = { ...legacy, user_id: 'User7K3P9X2DQ6WR' };
const optional: string | undefined = fresh.user_id;
void optional;