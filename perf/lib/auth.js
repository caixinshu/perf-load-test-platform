// ============================================================
// perf/lib/auth.js
// 认证相关 - 登录、token 管理、鉴权头
// ============================================================
import { apiPost } from './http.js';

let authToken = null;

/**
 * 登录获取 token
 * @param {string} loginPath - 登录接口路径
 * @param {object} credentials - { username, password }
 * @returns {string} token
 */
export function login(loginPath, credentials) {
  const res = apiPost(loginPath, credentials);
  if (res.status === 200) {
    const body = JSON.parse(res.body);
    authToken = body.token || body.access_token;
    return authToken;
  }
  return null;
}

/**
 * 设置 token（外部传入）
 */
export function setToken(token) {
  authToken = token;
}

/**
 * 获取当前 token
 */
export function getToken() {
  return authToken || __ENV.AUTH_TOKEN || '';
}

/**
 * 生成带鉴权头的 params
 * 用法：apiGet('/protected', withAuth())
 */
export function withAuth(extraParams = {}) {
  const token = getToken();
  return {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(extraParams.headers || {}),
    },
    ...extraParams,
  };
}

/**
 * 清除 token
 */
export function logout() {
  authToken = null;
}
