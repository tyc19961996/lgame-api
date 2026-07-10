/**
 * API 类型定义
 */

/** API 统一响应结构 */
export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
  timestamp: string;
}

/** 错误码 */
export enum ErrorCode {
  PARAM_ERROR = 400,
  PARAM_MISSING = 401,
  SIGNATURE_INVALID = 402,
  USER_NOT_FOUND = 403,
  PLATFORM_CONFIG_NOT_FOUND = 404,
  SYSTEM_INTERNAL_ERROR = 500,
}

/** getOpenId 响应数据 */
export interface OpenIdResponseData {
  open_id: string;
  token: string;
}

/** 提交分数参数 */
export interface SubmitScoreParams {
  game_key: string;
  leaderboard_key: string;
  score: number;
  player_name?: string;
  avatar_url?: string;
  extra_data?: Record<string, any>;
}

/** 提交分数响应 */
export interface SubmitScoreResponseData {
  updated: boolean;
  score: number;
  rank: number | null;
}

/** 假玩家数据（客户端传入，用于混入排行榜让榜单看起来更热闹） */
export interface MockPlayer {
  playerName: string;
  avatarUrl?: string;
  score: number;
}

/** 排行榜条目 */
export interface LeaderboardItem {
  rank: number;
  openid: string;
  player_name: string;
  avatar_url: string;
  score: number;
  extra_data: Record<string, any> | null;
  is_me?: boolean;
  is_mock?: boolean;
}

/** Top 排行榜响应 */
export interface TopListResponseData {
  game_key: string;
  leaderboard_key: string;
  leaderboard_name: string;
  period_key: string;
  total: number;
  list: LeaderboardItem[];
}

/** 我的排名响应 */
export interface MyRankResponseData {
  rank: number | null;
  score: number | null;
  player_name: string | null;
  avatar_url: string | null;
  extra_data: Record<string, any> | null;
  total: number;
}

/** 附近排名响应 */
export interface AroundMeResponseData {
  my_rank: number | null;
  my_score: number | null;
  list: LeaderboardItem[];
}

/** 保存游戏数据参数 */
export interface SaveGameDataParams {
  game_key: string;
  data: string;
}

/** 保存游戏数据响应 */
export interface SaveGameDataResponseData {
  saved: boolean;
}

/** 加载游戏数据响应 */
export interface LoadGameDataResponseData {
  data: string | null;
  updated_at: string | null;
}

/** 远程配置命中的规则（仅调试模式可能返回） */
export interface RemoteConfigMatchedRule {
  id: number;
  name: string;
  priority: number;
  platform: string;
}

/** 远程配置响应 */
export interface RemoteConfigResponseData<TConfig extends object = Record<string, any>> {
  game_key: string;
  platform: string;
  version: string;
  config: TConfig;
  matched_rules?: RemoteConfigMatchedRule[];
}

/** 创建邀请参数 */
export interface CreateInviteParams {
  game_key: string;
  task_key: string;
}

/** 创建邀请响应 */
export interface CreateInviteResponseData {
  invite_code: string;
  share_query: string;
}

/** 接受邀请响应 */
export interface AcceptInviteResponseData {
  accepted: boolean;
  reason?: 'already_accepted';
  task_key: string;
}

/** 玩家事件上报参数 */
export interface ReportPlayerEventParams {
  game_key: string;
  event_key: string;
  event_data?: Record<string, any>;
}

/** 玩家事件上报响应 */
export interface ReportPlayerEventResponseData {
  reported: boolean;
}

/** 邀请任务进度响应 */
export interface InviteProgressResponseData {
  task_key: string;
  target_count: number;
  current_count: number;
  completed: boolean;
  reward_claimed: boolean;
  reward: Record<string, any>;
}

/** 邀请任务领奖响应 */
export interface ClaimInviteRewardResponseData {
  claimed: boolean;
  reward: Record<string, any>;
}

/** 更新玩家资料参数 */
export interface UpdateProfileParams {
  game_key: string;
  player_name?: string;
  avatar_url?: string;
}

/** 更新玩家资料响应 */
export interface UpdateProfileResponseData {
  updated_rows: number;
}

/** 超越百分比响应 */
export interface PercentileResponseData {
  percentile: number | null;
  rank: number | null;
  total: number;
}
