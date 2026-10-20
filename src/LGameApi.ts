/**
 * LGameAPI - 通用游戏 API 客户端
 *
 * 使用流程:
 *   1. LGameAPI.init({ baseUrl, appid })  初始化（baseUrl 必填）
 *   2. await LGameAPI.login()       登录（自动适配平台/开发模式）
 *   3. await LGameAPI.submitScore() 提交分数
 *   4. await LGameAPI.getTopList()  查询排行榜
 *   5. await LGameAPI.saveGameData() 保存游戏数据
 *   6. await LGameAPI.loadGameData() 加载游戏数据
 *   7. await LGameAPI.getRemoteConfig() 获取远程配置
 *   8. await LGameAPI.getTimestamp() 获取服务端时间戳
 */
import type {
  ApiResponse,
  AnalyticsProperties,
  AnalyticsTrackOptions,
  AnalyticsFlushResult,
  OpenIdResponseData,
  SubmitScoreParams,
  SubmitScoreResponseData,
  TopListResponseData,
  MyRankResponseData,
  AroundMeResponseData,
  SaveGameDataParams,
  SaveGameDataResponseData,
  LoadGameDataResponseData,
  RemoteConfigResponseData,
  CreateInviteParams,
  CreateInviteResponseData,
  AcceptInviteResponseData,
  ReportPlayerEventParams,
  ReportPlayerEventResponseData,
  InviteProgressResponseData,
  ClaimInviteRewardResponseData,
  AliAdRewardPendingResponseData,
  ClaimAliAdRewardResponseData,
  SubmitGamecenterEventParams,
  SubmitGamecenterEventResponseData,
  UpdateProfileParams,
  UpdateProfileResponseData,
  PercentileResponseData,
  MockPlayer,
} from './types.js';

import { isDevMode, getPlatform, platformLogin, applyConfig, getBaseUrl, getAnalyticsBaseUrl } from './config.js';
import type { LGameApiOptions } from './config.js';
import { rawRequest, httpRequest } from './http.js';
import { getSession, clearSession, assertGeneration, bindLoginContext, commitSession, assertSession, SessionChangedError } from './session.js';

import { initializeAnalyticsSession } from './analytics-context.js';
import { configureAnalytics, trackEvent, flushAnalytics, analyticsLoginCompleted } from './analytics.js';

export class LGameAPI {

  /** 小程序 AppID（需在初始化时设置） */
  private static _appid: string = '';
  public static get appid(): string { return this._appid; }
  public static set appid(value: string) {
    if (value !== this._appid) { this.clearSession(); this._appid = value; }
  }

  /** 开发模式下的自定义 ID（用于区分不同开发者的数据） */
  private static _devId: string = 'default';
  public static get devId(): string { return this._devId; }
  public static set devId(value: string) {
    if (value !== this._devId) { this.clearSession(); this._devId = value; }
  }

  /** 平台标识 */
  public static get platform(): string {
    return getPlatform();
  }

  /** 当前用户的 openid */
  public static get openId(): string {
    return this._openId;
  }

  /** 当前内部用户编号；未登录或服务端未返回有效编号时为空字符串。 */
  public static get userId(): string {
    return getSession().userId;
  }

  /** 当前 JWT token */
  public static get token(): string {
    return this._token;
  }

  /** 是否已登录 */
  public static get isLoggedIn(): boolean {
    return !!this._token && !!this._openId && !getSession().expired;
  }

  private static get _openId(): string { return getSession().openId; }
  private static get _token(): string { return getSession().token; }
  private static _loginPromise: Promise<ApiResponse<OpenIdResponseData>> | null = null;
  private static _loginGeneration: number = -1;

  /** 清除会话，同时使正在进行的登录和业务请求结果失效。 */
  public static clearSession(): void {
    clearSession();
    this._loginPromise = null;
  }

  // ==================== 初始化 ====================

  /**
   * 初始化 SDK（必须在 login() 之前调用）
   * @param options.baseUrl 服务端接口地址（必填），如 https://example.com/api/v1/
   * @param options.analyticsBaseUrl 独立采集根地址，可选；配置后通过短期凭据直传事件
   * @param options.appid 小程序 AppID，等同于设置 LGameAPI.appid
   * @param options.devId 开发模式自定义 ID，等同于设置 LGameAPI.devId
   * @param options.isDevMode / getPlatform / platformLogin 可选，按项目重写平台适配逻辑，不传使用默认实现
   */
  public static init(options: LGameApiOptions): void {
    initializeAnalyticsSession(() => {
      this.clearSession();
      applyConfig({ ...options, analyticsBaseUrl: options.analyticsBaseUrl ?? '' });
      if (options.appid) this.appid = options.appid;
      if (options.devId) this.devId = options.devId;
    }, () => JSON.stringify([getBaseUrl(), getAnalyticsBaseUrl(), getPlatform(), this.appid, isDevMode(), this.devId]));
    configureAnalytics(options.onAnalyticsResult);
  }

  // ==================== 自定义打点 ====================

  /** 入队并返回事件ID；登录前由SDK暂存，取得有效user_id后自动发送。 */
  public static track(eventName: string, properties: AnalyticsProperties = {}, options: AnalyticsTrackOptions = {}): string {
    return trackEvent(eventName, properties, options);
  }

  /** 提交调用时的队列快照；检查results中的rejected和可选error判断实际结果。 */
  public static flushEvents(): Promise<AnalyticsFlushResult> { return flushAnalytics(); }

  // ==================== 服务端时间 ====================

  /**
   * 获取服务端当前 Unix 毫秒时间戳
   * @returns data 固定为 null，timestamp 为十进制毫秒时间戳字符串
   */
  public static async getTimestamp(): Promise<ApiResponse<null>> {
    return httpRequest<null>('timestamp', 'GET');
  }

  // ==================== 登录 ====================

  /**
   * 登录：自动识别平台环境
   * - 小游戏环境：调用平台 login 获取 code/token → 换取 openid + JWT
   * - 开发模式（浏览器）：调用 dev/login 接口获取模拟 openid + JWT
   */
  public static login(): Promise<ApiResponse<OpenIdResponseData>> {
    return this._startLogin(false);
  }

  /**
   * 静默重新登录（token 过期时由 http 模块自动调用）
   * @returns 是否登录成功
   */
  public static async _silentLogin(): Promise<boolean> {
    const session = getSession();
    try {
      const response = await this._startLogin(true);
      assertSession(session);
      return response.code === 0 && this.isLoggedIn;
    } catch (e) {
      if (e instanceof SessionChangedError) throw e;
      return false;
    }
  }

  private static _startLogin(refresh: boolean): Promise<ApiResponse<OpenIdResponseData>> {
    const generation = getSession().generation;
    if (this._loginPromise && this._loginGeneration === generation) return this._loginPromise;
    const appid = this.appid, platform = this.platform, devId = this.devId, dev = isDevMode();
    const promise = this._performLogin(generation, appid, platform, devId, dev, refresh);
    this._loginPromise = promise;
    this._loginGeneration = generation;
    // 旧登录结束时不能清除 clearSession 后的新登录任务。
    const finish = () => { if (this._loginPromise === promise) this._loginPromise = null; };
    promise.then(finish, finish);
    return promise;
  }

  private static async _performLogin(generation: number, appid: string, platform: string, devId: string, dev: boolean, refresh: boolean): Promise<ApiResponse<OpenIdResponseData>> {
    if (platform === 'harmony' && dev) throw new Error('Harmony 登录必须使用 native 平台适配，不支持开发登录替代');
    const baseUrl = getBaseUrl();
    bindLoginContext(platform, dev, baseUrl);
    const check = () => {
      assertGeneration(generation);
      if (appid !== this.appid || platform !== this.platform || devId !== this.devId || dev !== isDevMode() || baseUrl !== getBaseUrl()) throw new SessionChangedError();
    };
    let response: ApiResponse<OpenIdResponseData>;
    if (dev) {
      response = await rawRequest<OpenIdResponseData>('dev/login', 'POST', { appid, dev_id: devId });
    } else {
      // 每次新的登录任务都重新取得 code，不缓存一次性授权码。
      const loginRes = await platformLogin();
      check();
      const validString = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
      if (loginRes?.success === false || !validString(loginRes?.code)) throw new Error('平台登录未返回有效授权码');
      if (platform === 'harmony' && (loginRes?.success !== true || !validString(loginRes?.gamePlayerId))) {
        throw new Error('Harmony 平台登录未完成或缺少 gamePlayerId');
      }
      response = await rawRequest<OpenIdResponseData>('getOpenId', platform === 'harmony' ? 'POST' : 'GET', {
        appid, platform, code: loginRes.code,
        ...(platform === 'harmony' ? { gamePlayerId: loginRes.gamePlayerId } : {})
      });
    }
    check();
    if (response.code === 0) {
      const data = response.data;
      if (!data || typeof data.open_id !== 'string' || !data.open_id.trim() || typeof data.token !== 'string' || !data.token.trim()) {
        throw new Error('登录响应缺少有效 open_id 或 token');
      }
      const userId = typeof data.user_id === 'string' && data.user_id.trim() ? data.user_id : '';
      commitSession(generation, data.open_id, data.token, refresh, userId);
      analyticsLoginCompleted(!refresh);
    }
    return response;
  }

  // ==================== 远程配置 ====================

  /**
   * 获取远程配置
   * @param gameKey 游戏标识
   * @param version 当前客户端版本号，如 1.2.3
   * @returns config 为后台按游戏、平台、版本、时间和优先级合并后的 JSON 对象
   */
  public static async getRemoteConfig<TConfig extends object = Record<string, any>>(
    gameKey: string,
    version: string
  ): Promise<ApiResponse<RemoteConfigResponseData<TConfig>>> {
    return httpRequest<RemoteConfigResponseData<TConfig>>(
      'remote-config',
      'GET',
      { game_key: gameKey, version },
      this._token
    );
  }

  // ==================== 邀请任务 ====================

  /**
   * 创建邀请分享码
   * @param params 创建参数（game_key 和 task_key 必填）
   */
  public static async createInvite(params: CreateInviteParams): Promise<ApiResponse<CreateInviteResponseData>> {
    return httpRequest<CreateInviteResponseData>(
      'invite/create',
      'POST',
      params as unknown as Record<string, any>,
      this._token
    );
  }

  /**
   * 接受邀请
   * @param gameKey 游戏标识
   * @param inviteCode 启动参数中的 invite_code
   */
  public static async acceptInvite(gameKey: string, inviteCode: string): Promise<ApiResponse<AcceptInviteResponseData>> {
    return httpRequest<AcceptInviteResponseData>(
      'invite/accept',
      'POST',
      { game_key: gameKey, invite_code: inviteCode },
      this._token
    );
  }

  /**
   * 上报玩家事件，由服务端判断是否满足邀请任务条件
   * @param params 事件参数（game_key、event_key 必填）
   */
  public static async reportPlayerEvent(params: ReportPlayerEventParams): Promise<ApiResponse<ReportPlayerEventResponseData>> {
    return httpRequest<ReportPlayerEventResponseData>(
      'player-event/report',
      'POST',
      params as unknown as Record<string, any>,
      this._token
    );
  }

  /**
   * 查询邀请任务进度
   * @param gameKey 游戏标识
   * @param taskKey 邀请任务标识
   */
  public static async getInviteProgress(gameKey: string, taskKey: string): Promise<ApiResponse<InviteProgressResponseData>> {
    return httpRequest<InviteProgressResponseData>(
      'invite/progress',
      'GET',
      { game_key: gameKey, task_key: taskKey },
      this._token
    );
  }

  /**
   * 领取邀请任务奖励
   * @param gameKey 游戏标识
   * @param taskKey 邀请任务标识
   */
  public static async claimInviteReward(gameKey: string, taskKey: string): Promise<ApiResponse<ClaimInviteRewardResponseData>> {
    return httpRequest<ClaimInviteRewardResponseData>(
      'invite/claim',
      'POST',
      { game_key: gameKey, task_key: taskKey },
      this._token
    );
  }

  // ==================== 支付宝广告奖励 ====================

  /**
   * 查询支付宝广告是否有未领取奖励
   * @param gameKey 游戏标识
   */
  public static async getAliAdRewardPending(gameKey: string): Promise<ApiResponse<AliAdRewardPendingResponseData>> {
    return httpRequest<AliAdRewardPendingResponseData>(
      'ali-ad/reward/pending',
      'GET',
      { game_key: gameKey },
      this._token
    );
  }

  /**
   * 领取支付宝广告奖励
   * @param gameKey 游戏标识
   */
  public static async claimAliAdReward(gameKey: string): Promise<ApiResponse<ClaimAliAdRewardResponseData>> {
    return httpRequest<ClaimAliAdRewardResponseData>(
      'ali-ad/reward/claim',
      'POST',
      { game_key: gameKey },
      this._token
    );
  }

  // ==================== 支付宝游戏中心事件上报 ====================

  /**
   * 上报小游戏用户事件到支付宝游戏中心（仅支付宝平台可用）
   * 服务端将调用 alipay.user.gamecenter.event.submit 同步给游戏中心
   * @param params 事件参数（game_key、event_id 必填；event_finish_channel 建议传启动参数中的 channel）
   */
  public static async submitGamecenterEvent(params: SubmitGamecenterEventParams): Promise<ApiResponse<SubmitGamecenterEventResponseData>> {
    return httpRequest<SubmitGamecenterEventResponseData>(
      'gamecenter/event/submit',
      'POST',
      params as unknown as Record<string, any>,
      this._token
    );
  }

  // ==================== 排行榜 ====================

  /**
   * 提交分数
   * @param params 提交参数（game_key, leaderboard_key, score 必填）
   */
  public static async submitScore(params: SubmitScoreParams): Promise<ApiResponse<SubmitScoreResponseData>> {
    return httpRequest<SubmitScoreResponseData>(
      'leaderboard/submit',
      'POST',
      params as unknown as Record<string, any>,
      this._token
    );
  }

  /**
   * 获取排行榜 Top N
   * @param gameKey 游戏标识
   * @param leaderboardKey 排行榜标识
   * @param limit 返回数量（默认 50，最大 200）
   * @param offset 偏移量（默认 0）
   * @param mockPlayers 假玩家数据，可选。传入后会与真实数据合并排序
   */
  public static async getTopList(
    gameKey: string,
    leaderboardKey: string,
    limit: number = 50,
    offset: number = 0,
    mockPlayers?: MockPlayer[],
  ): Promise<ApiResponse<TopListResponseData>> {
    const params: Record<string, any> = { game_key: gameKey, leaderboard_key: leaderboardKey, limit, offset };
    if (mockPlayers && mockPlayers.length > 0) {
      params.mockPlayers = JSON.stringify(mockPlayers);
    }
    return httpRequest<TopListResponseData>(
      'leaderboard/top',
      'GET',
      params,
      this._token
    );
  }

  /**
   * 获取我的排名
   * @param gameKey 游戏标识
   * @param leaderboardKey 排行榜标识
   * @param mockPlayers 假玩家数据，可选。会影响排名计算
   */
  public static async getMyRank(gameKey: string, leaderboardKey: string, mockPlayers?: MockPlayer[]): Promise<ApiResponse<MyRankResponseData>> {
    const params: Record<string, any> = { game_key: gameKey, leaderboard_key: leaderboardKey };
    if (mockPlayers && mockPlayers.length > 0) {
      params.mockPlayers = JSON.stringify(mockPlayers);
    }
    return httpRequest<MyRankResponseData>(
      'leaderboard/myRank',
      'GET',
      params,
      this._token
    );
  }

  /**
   * 获取我附近的排名
   * @param gameKey 游戏标识
   * @param leaderboardKey 排行榜标识
   * @param limit 前后各取几名（默认 5，最大 20）
   * @param mockPlayers 假玩家数据，可选。会影响排名计算和附近列表
   */
  public static async getAroundMe(
    gameKey: string,
    leaderboardKey: string,
    limit: number = 5,
    mockPlayers?: MockPlayer[],
  ): Promise<ApiResponse<AroundMeResponseData>> {
    const params: Record<string, any> = { game_key: gameKey, leaderboard_key: leaderboardKey, limit };
    if (mockPlayers && mockPlayers.length > 0) {
      params.mockPlayers = JSON.stringify(mockPlayers);
    }
    return httpRequest<AroundMeResponseData>(
      'leaderboard/aroundMe',
      'GET',
      params,
      this._token
    );
  }

  /**
   * 更新玩家昵称和头像（更新该游戏下所有排行榜记录）
   * @param params 更新参数（game_key 必填，player_name 和 avatar_url 至少传一个）
   */
  public static async updateProfile(params: UpdateProfileParams): Promise<ApiResponse<UpdateProfileResponseData>> {
    return httpRequest<UpdateProfileResponseData>(
      'leaderboard/updateProfile',
      'POST',
      params as unknown as Record<string, any>,
      this._token
    );
  }

  /**
   * 获取超越玩家百分比
   * @param gameKey 游戏标识
   * @param leaderboardKey 排行榜标识
   * @param mockPlayers 假玩家数据，可选。会影响百分比计算
   * @returns percentile 为 0-100 的整数，未上榜时为 null
   */
  public static async getPercentile(gameKey: string, leaderboardKey: string, mockPlayers?: MockPlayer[]): Promise<ApiResponse<PercentileResponseData>> {
    const params: Record<string, any> = { game_key: gameKey, leaderboard_key: leaderboardKey };
    if (mockPlayers && mockPlayers.length > 0) {
      params.mockPlayers = JSON.stringify(mockPlayers);
    }
    return httpRequest<PercentileResponseData>(
      'leaderboard/percentile',
      'GET',
      params,
      this._token
    );
  }

  // ==================== 游戏数据存储 ====================

  /**
   * 保存游戏数据
   * @param params 保存参数（game_key 和 data 必填，data 为序列化后的字符串）
   */
  public static async saveGameData(params: SaveGameDataParams): Promise<ApiResponse<SaveGameDataResponseData>> {
    return httpRequest<SaveGameDataResponseData>(
      'gamedata/save',
      'POST',
      params as unknown as Record<string, any>,
      this._token
    );
  }

  /**
   * 加载游戏数据
   * @param gameKey 游戏标识
   * @returns data 为序列化后的字符串，无存档时 data 为 null
   */
  public static async loadGameData(gameKey: string): Promise<ApiResponse<LoadGameDataResponseData>> {
    return httpRequest<LoadGameDataResponseData>(
      'gamedata/load',
      'GET',
      { game_key: gameKey },
      this._token
    );
  }
}
