<!-- 一旦我所属的文件夹有所变化，请更新我 -->
# js/ - 核心 JavaScript 脚本
Chrome Extension 主要逻辑层，包含 background、content、popup、options 脚本。

| 文件 | 地位 | 功能 |
|------|------|------|
| `background.js` | 核心 | Service Worker，API 请求、消息路由 |
| `content.js` | 核心 | 内容脚本，DOM 操作、词汇替换 |
| `options.js` | 页面 | 设置页面逻辑 |
| `popup.js` | 页面 | 弹出窗口逻辑 |
| `core/` | 子目录 | 配置与存储模块 |
| `services/` | 子目录 | 服务层模块 |
