# Package Lens

一个强大的 VS Code 扩展，为 `pnpm-workspace.yaml` 和 `package.json` 提供 npm 包版本提示、自动补全和版本状态显示。

## ✨ 功能特性

### 📊 版本状态显示

在每行依赖后面显示版本状态 Emoji：

| Emoji | 状态 | 说明 |
|-------|------|------|
| ✅ | 最新 | 当前版本已是最新 |
| 🔶 | 有更新 | 存在更新的版本 |
| ❌ | 获取失败 | 无法获取版本信息 |
| 🔗 | 工作区引用 | `workspace:*` 等引用 |
| ⏭️ | 跳过 | `link:`, `file:` 等协议 |

### 🎯 版本自动补全

- 输入时自动提示可用版本列表
- 支持版本前缀：`^`、`~`、`>=`、`<=`、`>`、`<`
- 最新版本优先显示
- 空值时自动弹出版本列表

### 📦 别名支持

完整支持 npm 别名格式：

```yaml
catalog:
  # 无版本号的别名
  express: "npm:@karinjs/express"
  
  # 带版本号的别名
  axios: "npm:@karinjs/axios@1.13.0"
```

### 🔍 悬停信息

鼠标悬停在版本号上时显示：

- 当前版本与最新版本对比
- 最近 10 个版本列表
- 快速更新到最新版本按钮
- 选择其他版本的快速入口
- npm 包页面链接

### 📁 支持的文件

- `pnpm-workspace.yaml` - catalog 区块中的依赖
- `package.json` - dependencies, devDependencies 等区块

## 📥 安装

### 从 VS Code 扩展商店安装

1. 打开 VS Code
2. 按 `Ctrl+Shift+X` 打开扩展面板
3. 搜索 "Package Lens"
4. 点击安装

### 从源码安装

```bash
# 克隆仓库
git clone https://github.com/sj817/package-lens.git
cd package-lens

# 安装依赖
pnpm install

# 编译
pnpm run compile

# 打包
pnpm run package
```

## ⚙️ 配置项

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `packageLens.registry` | string | `""` | 自定义 npm 镜像源地址。留空则自动竞速选择最快的源 |
| `packageLens.cacheTimeout` | number | `300000` | 缓存超时时间（毫秒） |
| `packageLens.showVersionStatus` | boolean | `true` | 是否显示版本状态 Emoji |
| `packageLens.showLatestVersionHint` | boolean | `true` | 悬停时是否显示最新版本提示 |

### 配置示例

```json
{
  "packageLens.registry": "https://registry.npmjs.org",
  "packageLens.cacheTimeout": 600000,
  "packageLens.showVersionStatus": true
}
```

## 🔧 命令

| 命令 | 说明 |
|------|------|
| `Package Lens: 选择版本` | 打开版本选择列表 |
| `Package Lens: 刷新版本缓存` | 清除缓存并重新获取版本信息 |

## 📖 使用示例

### pnpm-workspace.yaml

```yaml
packages:
  - 'packages/*'

catalog:
  # 直接版本号 - 显示 ✅ 或 🔶
  chalk: 5.4.1
  typescript: ^5.3.0
  
  # 别名格式 - 自动解析真实包名
  axios: "npm:@karinjs/axios@1.13.0"
  express: "npm:@karinjs/express"

catalogs:
  react18:
    react: ^18.2.0
    react-dom: ^18.2.0
```

### package.json

```json
{
  "dependencies": {
    "lodash": "^4.17.21",
    "@karinjs/core": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.3.0"
  }
}
```

## 🛠️ 开发

### 环境要求

- Node.js >= 18
- pnpm >= 8
- VS Code >= 1.85.0

### 开发步骤

```bash
# 安装依赖
pnpm install

# 启动监听模式
pnpm run watch

# 按 F5 启动调试
```

### 项目结构

```
package-lens/
├── src/
│   ├── extension.ts              # 插件入口
│   ├── providers/
│   │   ├── completionProvider.ts # 自动补全
│   │   ├── hoverProvider.ts      # 悬停提示
│   │   └── decorationProvider.ts # 版本状态装饰
│   ├── services/
│   │   └── npmService.ts         # npm API 服务
│   └── utils/
│       ├── fileUtils.ts          # 文件解析工具
│       └── versionParser.ts      # 版本号解析
├── examples/
│   └── pnpm-workspace.yaml       # 测试示例
├── package.json
└── tsconfig.json
```

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支: `git checkout -b feature/amazing-feature`
3. 提交更改: `git commit -m 'Add amazing feature'`
4. 推送分支: `git push origin feature/amazing-feature`
5. 提交 Pull Request

## 📮 反馈

如有问题或建议，请在 [GitHub Issues](https://github.com/sj817/package-lens/issues) 中提出。
