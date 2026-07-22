/**
 * HTTP 请求工具
 * - rawRequest: 底层请求，不含重试
 * - httpRequest: 带 token 过期自动重试
 */
import type { ApiResponse } from './types';
import { getBaseUrl } from './config';

/**
 * 底层发送 HTTP 请求（不含重试逻辑）
 */
export function rawRequest<T>(path: string, method: 'GET' | 'POST', data?: Record<string, any>, token?: string): Promise<ApiResponse<T>> {

  return new Promise((resolve, reject) => {
    let url = `${getBaseUrl()}${path}`;

    if (method === 'GET' && data) {
      const params: string[] = [];
      Object.keys(data).forEach(key => {
        //@ts-ignore
        if (data[key] !== undefined && data[key] !== null) {
        //@ts-ignore
          params.push(`${encodeURIComponent(key)}=${encodeURIComponent(data[key])}`);
        }
      });
      if (token) {
        params.push(`token=${encodeURIComponent(token)}`);
      }
      if (params.length > 0) {
        url += '?' + params.join('&');
      }
    } else if (token) {
      data = { ...data, token };
    }

    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');

    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        try {
          const response = JSON.parse(xhr.responseText);
          resolve(response);
        } catch (e) {
          reject(new Error(`解析响应失败: status=${xhr.status}`));
        }
      }
    };

    xhr.onerror = function () {
      reject(new Error('网络错误'));
    };

    if (method === 'POST') {
      xhr.send(JSON.stringify(data));
    } else {
      xhr.send();
    }
  });
}

/**
 * 发送 HTTP 请求（自动处理 token 过期重试）
 * 收到 code=402 时自动重新登录，然后用新 token 重发请求
 */
export async function httpRequest<T>(path: string, method: 'GET' | 'POST', data?: Record<string, any>, token?: string): Promise<ApiResponse<T>> {
  const response = await rawRequest<T>(path, method, data, token);

  // 延迟导入避免循环依赖
  if (response.code === 402) {
    const { LGameAPI } = await import('./LGameApi');
    if (LGameAPI.isLoggedIn) {
      const ok = await LGameAPI._silentLogin();
      if (ok) {
        return rawRequest<T>(path, method, data, LGameAPI.token);
      }
    }
  }

  return response;
}
