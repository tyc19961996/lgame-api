/**
 * 平台登录适配
 */

/** 当前是否为开发模式 */
export function isDevMode(): boolean {
  return !window['wx'] && !window['ks'] && !window['tt'];
}

/** 当前平台标识 */
export function getPlatform(): string {
  if (window['ks']) return 'ks';
  if (window['wx']) return 'wechat';
  if (window['tt']) return 'bytedance';
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
    } else {
      reject(new Error('不支持的平台'));
    }
  });
}
