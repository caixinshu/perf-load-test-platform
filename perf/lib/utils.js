// ============================================================
// perf/lib/utils.js
// 工具函数 - 随机数、断言、响应检查等
// ============================================================
import { check, sleep as k6Sleep } from 'k6';

/**
 * 生成指定范围内的随机整数
 */
export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 从数组中随机取一个元素
 */
export function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * 生成随机字符串
 */
export function randomString(length = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * 检查响应状态码是否在指定范围
 */
export function assertStatus(res, expected = [200]) {
  return check(res, {
    [`status is ${expected.join('/')}`]: (r) => expected.includes(r.status),
  });
}

/**
 * 检查响应是否成功（2xx）
 */
export function assertSuccess(res) {
  return check(res, {
    'status is 2xx': (r) => r.status >= 200 && r.status < 300,
  });
}

/**
 * 检查响应体中是否包含指定字段
 */
export function assertBodyHas(res, field) {
  return check(res, {
    [`body has ${field}`]: (r) => {
      try {
        return field in JSON.parse(r.body);
      } catch (e) {
        return false;
      }
    },
  });
}

/**
 * 打印调试信息（k6 运行时）
 */
export function debug(label, value) {
  if (__ENV.DEBUG === 'true') {
    console.log(`[DEBUG] ${label}:`, typeof value === 'object' ? JSON.stringify(value) : value);
  }
}

/**
 * 等待指定毫秒
 */
export function sleep(ms) {
  // k6 的 sleep 接收秒，这里做毫秒到秒的转换
  k6Sleep(ms / 1000);
}
