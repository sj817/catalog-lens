# Changelog

All notable changes to "Package Lens" will be documented in this file.

## [0.1.2] - 2025-12-06

### ✨ 新功能

- 🔗 **工作区包路径显示**：`workspace:*` 引用现在会显示包的相对路径和版本号（如 `packages/core:2.0.0`）
- ⏭️ 支持 pnpm `catalog:` 协议语法
- 📦 新增 `WorkspacePackageService` 服务：自动扫描并缓存工作区内的包信息
- 🔄 工作区包信息随 `pnpm-workspace.yaml` 和 `package.json` 变化自动更新

### 🔧 优化

- 将所有配置项从 `catalogLens.*` 重命名为 `packageLens.*`
- 将所有命令从 `catalogLens.*` 重命名为 `packageLens.*`
- 使用 YAML 库解析 `pnpm-workspace.yaml`，更可靠

## [0.1.1] - 2025-12-06

### 变更

- 📦 项目重命名：从 "catalog-lens" 更名为 "package-lens"

## [0.0.1] - 2025-12-06

### Added

- 🎉 初始版本发布
- 📦 支持 `pnpm-workspace.yaml` 中 `catalog` 和 `catalogs` 区块的包版本提示
- 📦 支持 `package.json` 中 `dependencies`、`devDependencies` 等区块的包版本提示
- ✨ 自动补全：输入时自动弹出版本选择列表
- 🔍 悬停提示：显示当前版本、最新版本和版本列表
- 🎨 行尾装饰：显示版本状态 Emoji（✅ 最新 / 📦 可更新 / ❌ 错误）
- ⚡ 快速操作：一键更新到最新版本 / 选择其他版本
- 🚀 智能镜像源：自动竞速选择最快的 npm 镜像源
- 💾 持久化缓存：版本信息缓存到本地，加快响应速度
- 🔄 窗口聚焦刷新：切换回窗口时自动重试失败的请求
- 🌏 中文界面支持
