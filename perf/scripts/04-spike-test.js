// perf/scripts/04-spike-test.js
// Day 5：尖峰测试（Spike Test）
// 目的：验证系统对"突发流量"的承受能力，以及尖峰退去后的恢复能力（弹性）。
// 典型场景：秒杀、整点抢购、大 V 直播带货的瞬时涌入。
//
// 与压力测试的区别：
//   压力测试 = 缓慢阶梯加压，找"天花板"；
//   尖峰测试 = 瞬时陡增，看系统"抗不抗一下子砸过来的量"。
//
// 负载曲线：正常 10 VU → 10 秒内陡增到 200 VU → 持续 1 分钟 → 10 秒骤降回 10 → 恢复观察 1 分钟。

import http from 'k6/http';
import { check } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 10 },  // 正常负载：10 VU
    { duration: '10s', target: 200 }, // 尖峰：10 秒内陡增到 200 VU（不给自己缓冲时间）
    { duration: '1m', target: 200 },  // 持续尖峰：维持高压 1 分钟
    { duration: '10s', target: 10 },  // 骤降：10 秒内回落到正常
    { duration: '1m', target: 10 },   // 恢复观察：看系统能否回到正常水平
  ],
  // 不设阈值：尖峰测试是探索性的，先看"尖峰期间发生了什么"，再据此定 SLO
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';

export default function () {
  // 尖峰常发生在读多写少的场景（秒杀页浏览），这里打读接口
  const res = http.get(`${BASE_URL}/items`, { tags: { name: 'listItems' } });
  check(res, { 'status 200': (r) => r.status === 200 });
  // 不加 sleep：尖峰期间用户会疯狂刷新，VU 满负荷发请求
}
