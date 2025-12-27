# AGENTS

> **一旦任何功能、架构、写法更新，必须同步更新相关目录的 AGENTS.md 和文件头注释。**

## 项目概览
- Chrome Extension (Manifest V3)
- Background: `js/background.js`（service worker，module）
- Content script: `js/content.js`（非 ES module，整合在 IIFE 内）
- 配置：`chrome.storage.sync`
- 缓存：`chrome.storage.local`
- 段落缓存：`vocabmeld_segment_cache_v1`（词级缓存已弃用）

## 代码与协作约定
- 代码与标识符：英文
- 日志：中文
- 编码：UTF-8
- 优先保持现有代码风格与结构，遵循 KISS/DRY

## 文档架构规则
1. **每个文件夹**：有 `AGENTS.md`（3行架构说明 + 文件清单）
2. **每个代码文件开头**：`input`/`output`/`pos` 三行注释
3. **更新联动**：修改文件后更新其头注释及所属目录的 `AGENTS.md`
