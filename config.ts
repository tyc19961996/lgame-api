/**
 * 平台登录适配
 */

/** 当前是否为开发模式 */
export function isDevMode(): boolean {
  return !window['wx'] && !window['ks'] && !window['tt'] && !window['my'] && !window['bl'];
}

/** 当前平台标识 */
export function getPlatform(): string {
  if (window['my']) return 'ali';
  if (window['bl']) return 'bilibili';
  if (window['ks']) return 'ks';
  if (window['tt']) return 'bytedance';
  if (window['wx']) return 'wechat';
  return 'web';
}

/** 
 * 平台登录 
 * 可根据自己业务逻辑实现
 * @returns Promise<any> 返回平台登录成功的res
 * */
export function platformLogin(): Promise<any> {
  return new Promise((resolve, reject) => {
    if (window['ks']) {
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
