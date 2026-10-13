// perf/scripts/01-simple-get.js
// Day 2: 第一个 k6 压测脚本
// 10 VU 并发，持续 30 秒，模拟用户浏览商品列表

import http from 'k6/http';
import { check, sleep } from 'k6';

// 测试选项
export const options = {
  // 虚拟用户数
  vus: 10,
  // 持续时间
  duration: '30s',
};

// 默认函数：每个 VU 循环执行
export default function () {
  // 发送 GET 请求
  const res = http.get('http://localhost:8000/items');

  // 断言检查
  check(res, {
    '状态码是 200': (r) => r.status === 200,
    '响应时间 < 200ms': (r) => r.timings.duration < 200,
    '返回数据是数组': (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body);
      } catch (e) {
        return false;
      }
    },
  });

  // 思考时间：模拟用户操作间隔
  sleep(1);
}
