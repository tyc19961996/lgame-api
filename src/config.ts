/**
 * SDK 配置与平台登录适配
 * - baseUrl 不内置，必须通过 LGameAPI.init() 传入
 * - isDevMode / getPlatform / platformLogin 提供默认实现，可在 init 时按项目重写
 */

/** 平台适配函数集合 */
export interface PlatformAdapter {
  /** 当前是否为开发模式 */
  isDevMode: () => boolean;
  /** 当前平台标识（wechat / ali / ks / bytedance / bilibili / oppo / web 等） */
  getPlatform: () => string;
  /** 平台登录，resolve 值需包含 code 字段 */
  platformLogin: () => Promise<any>;
}

/** LGameAPI.init() 初始化选项 */
export interface LGameApiOptions extends Partial<PlatformAdapter> {
  /** 服务端接口地址，如 https://example.com/api/v1/ */
  baseUrl: string;
  /** 小程序 AppID，等同于设置 LGameAPI.appid */
  appid?: string;
  /** 开发模式下的自定义 ID，等同于设置 LGameAPI.devId */
  devId?: string;
}

// ==================== 默认实现（与旧版行为一致） ====================

/** 默认：无任何小游戏全局对象时视为开发模式 */
export function defaultIsDevMode(): boolean {
  return !window['wx'] && !window['ks'] && !window['tt'] && !window['my'] && !window['bl'] && !window['qg'];
}

/** 默认：根据全局对象识别平台 */
export function defaultGetPlatform(): string {
  if (window['qg']) return 'oppo';
  if (window['my']) return 'ali';
  if (window['bl']) return 'bilibili';
  if (window['ks']) return 'ks';
  if (window['tt']) return 'bytedance';
  if (window['wx']) return 'wechat';
  return 'web';
}

/** 默认：调用对应平台的登录接口获取 code */
export function defaultPlatformLogin(): Promise<any> {
  return new Promise((resolve, reject) => {
    if (window['qg']) {
      window['qg'].login({
        success: (res: any) => resolve({ ...res, ...(res.data || {}), code: res.data?.token || res.token || res.code }),
        fail: (err: any) => reject(new Error(`OPPO 登录失败: ${err.errMsg || err.errorMessage || err.error || '未知错误'}`)),
      });
    } else if (window['ks']) {
      window['ks'].login({
        success: (res: any) => resolve(res),
        fail: (err: any) => reject(new Error(`快手登录失败: ${err.errMsg}`)),
      });
    } else if (window['wx']) {
      window['wx'].login({
        success: (res: any) => resolve(res),
        fail: (err: any) => reject(new Error(`微信登录失败: ${err.errMsg}`)),
      });
    } else if (window['tt']) {
      window['tt'].login({
        success: (res: any) => resolve(res),
        fail: (err: any) => reject(new Error(`抖音登录失败: ${err.errMsg}`)),
      });
    } else if (window['my']) {
      window['my'].getAuthCode({
        scopes: 'auth_base',
        success: (res: any) => resolve({ ...res, code: res.authCode }),
        fail: (err: any) => reject(new Error(`支付宝登录失败: ${err.errorMessage || err.errMsg || err.error}`)),
      });
    } else if (window['bl']) {
      window['bl'].login({
        success: (res: any) => resolve(res),
        fail: (err: any) => reject(new Error(`Bilibili登录失败: ${err.errMsg || err.errorMessage || err.error}`)),
      });
    } else {
      reject(new Error('不支持的平台'));
    }
  });
}

// ==================== 当前生效配置 ====================

let currentBaseUrl: string = '';

const currentAdapter: PlatformAdapter = {
  isDevMode: defaultIsDevMode,
  getPlatform: defaultGetPlatform,
  platformLogin: defaultPlatformLogin,
};

/**
 * 应用配置（由 LGameAPI.init() 调用）
 * 未传入的适配函数保持当前值不变
 */
export function applyConfig(options: LGameApiOptions): void {
  if (options.baseUrl) {
    currentBaseUrl = options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`;
  }
  if (options.isDevMode) currentAdapter.isDevMode = options.isDevMode;
  if (options.getPlatform) currentAdapter.getPlatform = options.getPlatform;
  if (options.platformLogin) currentAdapter.platformLogin = options.platformLogin;
}

/** 获取服务端接口地址，未初始化时抛出错误 */
export function getBaseUrl(): string {
  if (!currentBaseUrl) {
    throw new Error('LGameAPI 未初始化，请先调用 LGameAPI.init({ baseUrl: "https://your-server/api/v1/" })');
  }
  return currentBaseUrl;
}

/** 当前是否为开发模式 */
export function isDevMode(): boolean {
  return currentAdapter.isDevMode();
}

/** 当前平台标识 */
export function getPlatform(): string {
  return currentAdapter.getPlatform();
}

/**
 * 平台登录
 * @returns Promise<any> 返回平台登录成功的 res（需包含 code）
 */
export function platformLogin(): Promise<any> {
  return currentAdapter.platformLogin();
}
