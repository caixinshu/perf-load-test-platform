// ============================================================
// perf/lib/http.js
// HTTP 请求封装 - 统一 get/post/put/delete 接口
// 使用：import { initHttp, apiGet, apiPost } from '../lib/http.js';
// ============================================================
import http from 'k6/http';
import { getEnv, currentEnv } from '../config/base.js';

let baseUrl = '';

/**
 * 初始化 HTTP 模块，设置 baseUrl
 * @param {string} env - 环境名，默认从 __ENV.ENV 读取
 */
export function initHttp(env) {
  const config = getEnv(env || currentEnv());
  baseUrl = config.baseUrl;
}

/**
 * 拼接完整 URL
 */
function buildUrl(path) {
  if (!baseUrl) {
    initHttp();
  }
  // 支持绝对路径传入
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  return baseUrl + path;
}

/**
 * GET 请求
 */
export function apiGet(path, params = {}) {
  const url = buildUrl(path);
  const defaultParams = {
    timeout: '10s',
    ...params,
  };
  return http.get(url, defaultParams);
}

/**
 * POST 请求
 */
export function apiPost(path, body, params = {}) {
  const url = buildUrl(path);
  const defaultParams = {
    headers: { 'Content-Type': 'application/json' },
    timeout: '10s',
    ...params,
  };
  return http.post(url, JSON.stringify(body), defaultParams);
}

/**
 * PUT 请求
 */
export function apiPut(path, body, params = {}) {
  const url = buildUrl(path);
  const defaultParams = {
    headers: { 'Content-Type': 'application/json' },
    timeout: '10s',
    ...params,
  };
  return http.put(url, JSON.stringify(body), defaultParams);
}

/**
 * DELETE 请求
 */
export function apiDel(path, params = {}) {
  const url = buildUrl(path);
  const defaultParams = {
    timeout: '10s',
    ...params,
  };
  return http.del(url, defaultParams);
}

/**
 * 批量请求（k6 batch）
 */
export function apiBatch(requests) {
  return http.batch(requests.map((r) => {
    const [method, path, ...rest] = r;
    const url = buildUrl(path);
    return [method.toUpperCase(), url, ...rest];
  }));
}
