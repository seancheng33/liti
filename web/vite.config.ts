import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 部署子路径。
 *
 * 挂到已有站点的子目录下（例如 https://example.com/liti/）时，前端所有资源
 * 必须带同样的前缀，否则浏览器会去站根找 /assets/xxx.js，拿到的是别人家的
 * 404，页面一片空白 —— 这是子路径部署最常见的翻车方式。
 *
 * 值由环境变量 VITE_BASE_PATH 提供（Dockerfile 从 BASE_PATH 传进来），
 * 运行时服务端读的是同一个 BASE_PATH，两边必须一致。
 */
const rawBase = process.env.VITE_BASE_PATH || '/liti/';
const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;
/** 去掉尾部斜杠，供 dev server 的代理前缀使用；根路径时为空串 */
const prefix = base.replace(/\/$/, '');

// Windows 的 Git Bash（MSYS2）会把以 / 开头的环境变量值当成本地路径来转换，
// "/liti/" 会变成 "C:/Program Files/Git/liti/" —— 打包出来的 index.html 里
// 资源地址直接指向本机磁盘，部署上去必然白屏，而且不报错。这里直接拦下来。
if (process.platform === 'win32' && /\\|^[a-zA-Z]:/.test(base)) {
  throw new Error(
    `VITE_BASE_PATH 被转成了本地路径：${base}\n`
      + '在 Git Bash 里构建请加前缀：MSYS_NO_PATHCONV=1 VITE_BASE_PATH=/liti/ ...\n'
      + '或者改用 docker compose 构建（值从 .env 读，不经过 shell）。',
  );
}

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // 开发时前端请求 /liti/api/xxx，代理到本地后端。
      // 后端同样跑在 BASE_PATH=/liti/ 下，所以这里**不去掉**前缀，原样转发。
      [`${prefix}/api`]: 'http://127.0.0.1:8080',
    },
  },
});
