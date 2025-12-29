<!-- 一旦我所属的文件夹有所变化，请更新我 -->
# js/ - 核心 JavaScript 脚本
Chrome Extension 主要逻辑层，包含 background、content、popup、options 脚本。

| 文件 | 地位 | 功能 |
|------|------|------|
| `background.js` | 核心 | Service Worker，API 请求、消息路由；右键菜单通过 `translateSelectionWithContext` 消息委托给 content 处理（仅翻译显示，不自动加入记忆列表） |
| `content.js` | 核心 | 内容脚本，DOM 操作、词汇替换、段落级缓存（无词级缓存，含处理中指示器：自转防御、行内插入防错位、链接内不越界可清理、处理锁与 UI 解耦+30s 超时兜底、LLM 请求 60s 硬超时防内存泄漏）；右键上下文缓存 `lastContextMenuSelection` 用于“翻译文本”的上下文感知翻译 |
| `options.js` | 页面 | 设置页面逻辑（词汇管理含翻译历史） |
| `popup.js` | 页面 | 弹出窗口逻辑 |
| `core/` | 子目录 | 配置与存储模块 |
| `services/` | 子目录 | 服务层模块 |
