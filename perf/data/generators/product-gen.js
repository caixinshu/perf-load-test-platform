// ============================================================
// perf/data/generators/product-gen.js
// 商品测试数据生成器 (Node.js 脚本，非 k6 脚本)
// 用法: node product-gen.js [数量] [输出文件]
// 示例: node product-gen.js 1000 ../products.json
// ============================================================
const fs = require('fs');
const path = require('path');

const count = parseInt(process.argv[2], 10) || 100;
const output = process.argv[3] || path.join(__dirname, '..', 'products.json');

function randomName(i) {
  const prefixes = ['数码', '家居', '服饰', '食品', '美妆', '运动', '图书', '玩具'];
  const suffixes = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const p = prefixes[i % prefixes.length];
  const s = suffixes[Math.floor(Math.random() * suffixes.length)];
  return `${p}-${s}-${i.toString().padStart(4, '0')}`;
}

const products = [];
for (let i = 1; i <= count; i++) {
  products.push({
    id: i,
    name: randomName(i),
    price: Math.floor(Math.random() * 9900) + 100, // 100 ~ 10000
    stock: Math.floor(Math.random() * 500) + 10,    // 10 ~ 510
  });
}

fs.writeFileSync(output, JSON.stringify(products, null, 2), 'utf8');
console.log(`已生成 ${count} 条商品数据 -> ${output}`);
