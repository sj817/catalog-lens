import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import * as yaml from 'yaml'
import JSON5 from 'json5'
import { outputChannel } from '../extension'

/** 工作区包信息 */
export interface WorkspacePackageInfo {
  /** 包名 */
  name: string
  /** 版本 */
  version: string
  /** 相对于工作区的路径 */
  relativePath: string
  /** 绝对路径 */
  absolutePath: string
}

/** glob 匹配选项 */
interface GlobPattern {
  pattern: string
  isNegation: boolean
}

/**
 * 工作区包服务
 * 解析 pnpm-workspace.yaml 中的 packages 字段，缓存工作区内的包信息
 */
export class WorkspacePackageService implements vscode.Disposable {
  /** 缓存: 包名 -> 包信息 */
  private packageCache: Map<string, WorkspacePackageInfo> = new Map()
  /** packages 配置的原始值，用于检测变化 */
  private packagesConfigCache: string = ''
  /** 工作区根目录 */
  private workspaceRoot: string | undefined
  private disposables: vscode.Disposable[] = []
  private context: vscode.ExtensionContext | undefined

  constructor (context?: vscode.ExtensionContext) {
    this.context = context

    // 获取工作区根目录
    this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    outputChannel?.appendLine(`[WorkspacePackageService] 工作区根目录: ${this.workspaceRoot}`)

    // 从持久化存储加载缓存
    this.loadCache()

    // 初始化时扫描
    this.scanWorkspacePackages()

    // 监听窗口聚焦，检查配置变化
    this.disposables.push(
      vscode.window.onDidChangeWindowState(state => {
        if (state.focused) {
          this.checkAndRefreshIfNeeded()
        }
      })
    )

    // 监听 pnpm-workspace.yaml 文件变化
    const watcher = vscode.workspace.createFileSystemWatcher('**/pnpm-workspace.yaml')
    this.disposables.push(
      watcher.onDidChange(() => this.scanWorkspacePackages()),
      watcher.onDidCreate(() => this.scanWorkspacePackages()),
      watcher.onDidDelete(() => this.clearCache()),
      watcher
    )

    // 监听 package.json 文件变化
    const pkgWatcher = vscode.workspace.createFileSystemWatcher('**/package.json')
    this.disposables.push(
      pkgWatcher.onDidChange(() => this.scanWorkspacePackages()),
      pkgWatcher.onDidCreate(() => this.scanWorkspacePackages()),
      pkgWatcher.onDidDelete(() => this.scanWorkspacePackages()),
      pkgWatcher
    )
  }

  /** 从持久化存储加载缓存 */
  private loadCache (): void {
    if (!this.context) return

    const cached = this.context.globalState.get<{
      packages: Array<[string, WorkspacePackageInfo]>
      config: string
    }>('workspacePackageCache')

    if (cached) {
      this.packageCache = new Map(cached.packages)
      this.packagesConfigCache = cached.config
    }
  }

  /** 保存缓存到持久化存储 */
  private saveCache (): void {
    if (!this.context) return

    this.context.globalState.update('workspacePackageCache', {
      packages: Array.from(this.packageCache.entries()),
      config: this.packagesConfigCache,
    })
  }

  /** 检查配置是否变化，如果变化则刷新 */
  private checkAndRefreshIfNeeded (): void {
    if (!this.workspaceRoot) return

    const yamlPath = path.join(this.workspaceRoot, 'pnpm-workspace.yaml')
    if (!fs.existsSync(yamlPath)) return

    const content = fs.readFileSync(yamlPath, 'utf-8')
    const packagesMatch = content.match(/packages:\s*([\s\S]*?)(?=\n\w+:|$)/m)
    const currentConfig = packagesMatch ? packagesMatch[1].trim() : ''

    if (currentConfig !== this.packagesConfigCache) {
      this.scanWorkspacePackages()
    }
  }

  /** 扫描工作区中的所有包 */
  scanWorkspacePackages (): void {
    this.packageCache.clear()

    if (!this.workspaceRoot) {
      outputChannel?.appendLine('[WorkspacePackageService] 没有工作区根目录')
      return
    }

    const yamlPath = path.join(this.workspaceRoot, 'pnpm-workspace.yaml')
    outputChannel?.appendLine(`[WorkspacePackageService] 检查 pnpm-workspace.yaml: ${yamlPath}`)

    if (!fs.existsSync(yamlPath)) {
      outputChannel?.appendLine('[WorkspacePackageService] pnpm-workspace.yaml 不存在，不是 pnpm 工作区')
      return
    }

    try {
      const content = fs.readFileSync(yamlPath, 'utf-8')
      const patterns = this.parsePackagesConfig(content)
      outputChannel?.appendLine(`[WorkspacePackageService] 解析到 packages 配置: ${JSON.stringify(patterns)}`)

      // 缓存当前配置
      const packagesMatch = content.match(/packages:\s*([\s\S]*?)(?=\n\w+:|$)/m)
      this.packagesConfigCache = packagesMatch ? packagesMatch[1].trim() : ''

      // 获取所有包目录
      const packageDirs = this.resolvePackagePatterns(this.workspaceRoot, patterns)
      outputChannel?.appendLine(`[WorkspacePackageService] 找到包目录: ${JSON.stringify(packageDirs)}`)

      // 读取每个包的 package.json
      for (const dir of packageDirs) {
        const pkgJsonPath = path.join(dir, 'package.json')
        if (fs.existsSync(pkgJsonPath)) {
          try {
            const pkgJson = JSON5.parse(fs.readFileSync(pkgJsonPath, 'utf-8'))
            if (pkgJson.name && pkgJson.version) {
              const relativePath = path.relative(this.workspaceRoot, dir).replace(/\\/g, '/')
              this.packageCache.set(pkgJson.name, {
                name: pkgJson.name,
                version: pkgJson.version,
                relativePath,
                absolutePath: dir,
              })
              outputChannel?.appendLine(`[WorkspacePackageService] 添加包: ${pkgJson.name}@${pkgJson.version} 路径: ${relativePath}`)
            }
          } catch (err) {
            outputChannel?.appendLine(`[WorkspacePackageService] 解析 package.json 失败: ${pkgJsonPath} - ${err}`)
          }
        }
      }

      outputChannel?.appendLine(`[WorkspacePackageService] 扫描完成，共找到 ${this.packageCache.size} 个包`)
      this.saveCache()
    } catch (err) {
      outputChannel?.appendLine(`[WorkspacePackageService] 扫描失败: ${err}`)
    }
  }

  /** 解析 packages 配置 */
  private parsePackagesConfig (content: string): GlobPattern[] {
    const patterns: GlobPattern[] = []

    try {
      const doc = yaml.parse(content)
      const packages = doc?.packages

      outputChannel?.appendLine(`[WorkspacePackageService] YAML 解析 packages: ${JSON.stringify(packages)}`)

      if (!packages || !Array.isArray(packages)) {
        outputChannel?.appendLine('[WorkspacePackageService] packages 不是数组或不存在')
        return patterns
      }

      for (const item of packages) {
        if (typeof item !== 'string') continue

        const isNegation = item.startsWith('!')
        const pattern = isNegation ? item.slice(1) : item

        outputChannel?.appendLine(`[WorkspacePackageService] 解析 pattern: ${item} -> pattern: ${pattern} isNegation: ${isNegation}`)
        patterns.push({ pattern, isNegation })
      }
    } catch (err) {
      outputChannel?.appendLine(`[WorkspacePackageService] YAML 解析失败: ${err}`)
    }

    return patterns
  }

  /** 解析 glob 模式，返回匹配的目录列表 */
  private resolvePackagePatterns (workspacePath: string, patterns: GlobPattern[]): string[] {
    const matchedDirs = new Set<string>()
    const excludedDirs = new Set<string>()

    for (const { pattern, isNegation } of patterns) {
      const dirs = this.expandGlobPattern(workspacePath, pattern)

      if (isNegation) {
        dirs.forEach(d => excludedDirs.add(d))
      } else {
        dirs.forEach(d => matchedDirs.add(d))
      }
    }

    // 移除被排除的目录
    excludedDirs.forEach(d => matchedDirs.delete(d))

    return Array.from(matchedDirs)
  }

  /** 展开 glob 模式 */
  private expandGlobPattern (basePath: string, pattern: string): string[] {
    const results: string[] = []

    // 安全检查：禁止路径遍历
    if (pattern.includes('..')) {
      outputChannel?.appendLine(`[WorkspacePackageService] 跳过包含 '..' 的不安全路径模式: ${pattern}`)
      return results
    }

    if (pattern.includes('**')) {
      // 递归匹配: packages/** 或 components/**
      const prefix = pattern.split('**')[0].replace(/\/$/, '')
      const searchPath = path.join(basePath, prefix)
      if (fs.existsSync(searchPath)) {
        this.findPackagesRecursively(searchPath, results)
      }
    } else if (pattern.includes('*')) {
      // 单层匹配: packages/* 或 apps/*
      const prefix = pattern.split('*')[0].replace(/\/$/, '')
      const searchPath = path.join(basePath, prefix)
      if (fs.existsSync(searchPath) && fs.statSync(searchPath).isDirectory()) {
        const entries = fs.readdirSync(searchPath, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            const dirPath = path.join(searchPath, entry.name)
            if (fs.existsSync(path.join(dirPath, 'package.json'))) {
              results.push(dirPath)
            }
          }
        }
      }
    } else {
      // 直接指定的目录: my-app
      const dirPath = path.join(basePath, pattern)
      if (fs.existsSync(dirPath) && fs.existsSync(path.join(dirPath, 'package.json'))) {
        results.push(dirPath)
      }
    }

    return results
  }

  /** 递归查找包含 package.json 的目录 */
  private findPackagesRecursively (dirPath: string, results: string[]): void {
    try {
      if (fs.existsSync(path.join(dirPath, 'package.json'))) {
        results.push(dirPath)
        return
      }

      const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          this.findPackagesRecursively(path.join(dirPath, entry.name), results)
        }
      }
    } catch {
      // 忽略权限错误
    }
  }

  /** 根据包名获取包信息 */
  getPackageInfo (packageName: string): WorkspacePackageInfo | undefined {
    const info = this.packageCache.get(packageName)
    outputChannel?.appendLine(`[WorkspacePackageService] 查询包: ${packageName} 结果: ${info ? `${info.relativePath}:${info.version}` : '未找到'}`)
    return info
  }

  /** 兼容旧接口 */
  async getPackageInfoForFile (_filePath: string, packageName: string): Promise<WorkspacePackageInfo | undefined> {
    const info = this.packageCache.get(packageName)
    outputChannel?.appendLine(`[WorkspacePackageService] 查询包(async): ${packageName} 结果: ${info ? `${info.relativePath}:${info.version}` : '未找到'}`)
    return info
  }

  /** 获取所有工作区包 */
  getAllPackages (): WorkspacePackageInfo[] {
    return Array.from(this.packageCache.values())
  }

  /** 清除缓存 */
  clearCache (): void {
    this.packageCache.clear()
    this.packagesConfigCache = ''
    if (this.context) {
      this.context.globalState.update('workspacePackageCache', undefined)
    }
  }

  dispose (): void {
    this.disposables.forEach(d => d.dispose())
  }
}
