import type { OpenIdResponseData } from '../src/types.js';
const legacy: OpenIdResponseData = { open_id: 'platform-player', token: 'signed-token' };
const fresh: OpenIdResponseData = { ...legacy, user_id: 'internal-player-id' };
const optional: string | undefined = fresh.user_id;
void optional;