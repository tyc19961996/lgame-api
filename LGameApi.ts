/**
 * LGameAPI - 通用游戏 API 客户端
 *
 * 使用流程:
 *   1. LGameAPI.appid = 'xxx'      设置 appid
 *   2. await LGameAPI.login()       登录（自动适配平台/开发模式）
 *   3. await LGameAPI.submitScore() 提交分数
 *   4. await LGameAPI.getTopList()  查询排行榜
 *   5. await LGameAPI.saveGameData() 保存游戏数据
 *   6. await LGameAPI.loadGameData() 加载游戏数据
 */
import type {
  ApiResponse,
  OpenIdResponseData,
  SubmitScoreParams,
  SubmitScoreResponseData,
  TopListResponseData,
  MyRankResponseData,
  AroundMeResponseData,
  SaveGameDataParams,
  SaveGameDataResponseData,
  LoadGameDataResponseData,
  UpdateProfileParams,
  UpdateProfileResponseData,
  PercentileResponseData,
  MockPlayer,
} from './types';

import { isDevMode, getPlatform, platformLogin } from './config';
import { rawRequest, httpRequest } from './http';

export class LGameAPI {

  /** 小程序 AppID（需在初始化时设置） */
  public static appid: string = '';

  /** 开发模式下的自定义 ID（用于区分不同开发者的数据） */
  public static devId: string = 'default';

  /** 平台标识 */
  public static get platform(): string {
    return getPlatform();
  }

  /** 当前用户的 openid */
  public static get openId(): string {
    return this._openId;
  }

  /** 当前 JWT token */
  public static get token(): string {
    return this._token;
  }

  /** 是否已登录 */
  public static get isLoggedIn(): boolean {
    return !!this._token;
  }

  private static _openId: string = '';
  private static _token: string = '';

  // ==================== 登录 ====================

  /**
   * 登录：自动识别平台环境
   * - 小游戏环境：调用平台 login 获取 code → 换取 openid + JWT
   * - 开发模式（浏览器）：调用 dev/login 接口获取模拟 openid + JWT
   */
  public static async login(): Promise<ApiResponse<OpenIdResponseData>> {
    if (isDevMode()) {
      return this._devLogin();
    }

    const loginRes = await platformLogin();
    const code = loginRes?.code;

    const response = await httpRequest<OpenIdResponseData>(
      'getOpenId',
      'GET',
      { appid: this.appid, platform: this.platform, code }
    );

    if (response.code === 0 && response.data) {
      this._openId = response.data.open_id;
      this._token = response.data.token;
    }

    return response;
  }

  /**
   * 静默重新登录（token 过期时由 http 模块自动调用）
   * @returns 是否登录成功
   */
  public static async _silentLogin(): Promise<boolean> {
    try {
      if (isDevMode()) {
        const res = await this._devLogin();
        return res.code === 0;
      }

      const loginRes = await platformLogin();
      const code = loginRes?.code;
      
      const response = await rawRequest<OpenIdResponseData>(
        'getOpenId',
        'GET',
        { appid: this.appid, platform: this.platform, code }
      );
      if (response.code === 0 && response.data) {
        this._openId = response.data.open_id;
        this._token = response.data.token;
        return true;
      }
    } catch (e) {
      // 静默登录失败，不抛异常
    }
    return false;
  }

  /** 开发模式登录（内部调用） */
  private static async _devLogin(): Promise<ApiResponse<OpenIdResponseData>> {
    const response = await rawRequest<OpenIdResponseData>(
      'dev/login',
      'POST',
      { appid: this.appid, dev_id: this.devId }
    );

    if (response.code === 0 && response.data) {
      this._openId = response.data.open_id;
      this._token = response.data.token;
    }

    return response;
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
