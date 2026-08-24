import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node18',
  clean: true,
  dts: false,
  sourcemap: false,
  // 保留 node: 前缀（node:sqlite 等内置模块），否则打包后运行时无法解析
  removeNodeProtocol: false,
  // 第三方依赖（commander/chokidar）一并打包进 cli.js，使其成为真正自包含的 bundle：
  // 桌面应用安装后 cli.js 与 exe 同目录，没有仓库的 node_modules 也能独立运行
  noExternal: ['commander', 'chokidar'],
  // commander 是 CJS：esbuild 把其中的动态 require 包进 __require shim，
  // 而 ESM 输出里没有 require，会抛 "Dynamic require ... is not supported"。
  // 在文件头注入 createRequire 垫片（shim 内部有 typeof require 检查，注入后即通过）。
  banner: {
    js: 'import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);\n',
  },
});
