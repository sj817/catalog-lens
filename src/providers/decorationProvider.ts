import * as vscode from 'vscode'
import { format } from 'node:util'
import { NpmService } from '../services/npmService'
import { WorkspacePackageService } from '../services/workspacePackageService'
import { parsePackageValue } from '../utils/versionParser'

/** 版本状态 */
export enum VersionStatus {
  /** 最新版本 */
  Latest = 'latest',
  /** 有更新可用 */
  Outdated = 'outdated',
  /** 获取失败 */
  Error = 'error',
  /** 加载中 */
  Loading = 'loading',
  /** 工作区引用 (workspace:*) */
  Workspace = 'workspace',
  /** 跳过检查 */
  Skipped = 'skipped',
}

/** 版本状态信息 */
export interface VersionStatusInfo {
  status: VersionStatus
  currentVersion: string
  latestVersion?: string
  message?: string
  fetchedAt?: number
}

/** 缓存数据结构 */
interface CacheData {
  [key: string]: VersionStatusInfo
}

/** 状态对应的 Emoji */
const STATUS_EMOJI: Record<VersionStatus, string> = {
  [VersionStatus.Latest]: '✅',
  [VersionStatus.Outdated]: '🔶',
  [VersionStatus.Error]: '❌',
  [VersionStatus.Loading]: '⏳',
  [VersionStatus.Workspace]: '🔗',
  [VersionStatus.Skipped]: '⏭️',
}

/** 状态对应的颜色 */
const STATUS_COLORS: Record<VersionStatus, string> = {
  [VersionStatus.Latest]: '#4ec9b0',
  [VersionStatus.Outdated]: '#c586c0',
  [VersionStatus.Error]: '#f14c4c',
  [VersionStatus.Loading]: '#808080',
  [VersionStatus.Workspace]: '#569cd6',
  [VersionStatus.Skipped]: '#808080',
}

/** 缓存有效期 (1小时) */
const CACHE_TTL = 60 * 60 * 1000

/** 输出日志通道 */
let outputChannel: vscode.OutputChannel | undefined

function getOutputChannel (): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('Package Lens')
  }
  return outputChannel
}

function log (message: string): void {
  const channel = getOutputChannel()
  const timestamp = new Date().toISOString()
  channel.appendLine(`[${timestamp}] ${message}`)
}

function logError (message: string, error?: unknown): void {
  const channel = getOutputChannel()
  const timestamp = new Date().toISOString()
  channel.appendLine(`[${timestamp}] ❌ ${message}`)
  if (error) {
    channel.appendLine(format(error))
  }
  // 发生错误时显示输出通道
  channel.show(true)
}

export class VersionDecorationProvider implements vscode.Disposable {
  private decorationType: vscode.TextEditorDecorationType
  private disposables: vscode.Disposable[] = []
  private updateTimeout: NodeJS.Timeout | undefined
  private versionCache: Map<string, VersionStatusInfo> = new Map()
  private context: vscode.ExtensionContext | undefined
  private workspacePackageService: WorkspacePackageService | undefined

  constructor (
    private npmService: NpmService,
    context?: vscode.ExtensionContext,
    workspacePackageService?: WorkspacePackageService
  ) {
    this.context = context
    this.workspacePackageService = workspacePackageService
    this.decorationType = vscode.window.createTextEditorDecorationType({
      after: {
        margin: '0 0 0 1em',
      },
    })

    // 初始化输出通道并记录启动日志
    log('Package Lens 已启动')

    // 从持久化存储加载缓存
    this.loadCache()

    // 监听编辑器切换
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) {
          this.triggerUpdateDecorations(editor, false)
        }
      })
    )

    // 监听文档变化
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument(event => {
        const editor = vscode.window.activeTextEditor
        if (editor && event.document === editor.document) {
          this.triggerUpdateDecorations(editor, false)
        }
      })
    )

    // 监听窗口聚焦 - 被动刷新，同时重试失败的包
    this.disposables.push(
      vscode.window.onDidChangeWindowState(state => {
        if (state.focused && vscode.window.activeTextEditor) {
          // 窗口获得焦点时，后台刷新版本，并重试之前失败的包
          this.triggerUpdateDecorationsWithRetry(vscode.window.activeTextEditor)
        }
      })
    )

    // 初始更新
    if (vscode.window.activeTextEditor) {
      this.triggerUpdateDecorations(vscode.window.activeTextEditor, false)
    }
  }

  /** 从持久化存储加载缓存 */
  private loadCache (): void {
    if (!this.context) return

    const cached = this.context.globalState.get<CacheData>('versionCache')
    if (cached) {
      const now = Date.now()
      for (const [key, value] of Object.entries(cached)) {
        // 只加载未过期的缓存
        if (value.fetchedAt && now - value.fetchedAt < CACHE_TTL) {
          this.versionCache.set(key, value)
        }
      }
    }
  }

  /** 保存缓存到持久化存储 */
  private saveCache (): void {
    if (!this.context) return

    const cacheData: CacheData = {}
    this.versionCache.forEach((value, key) => {
      cacheData[key] = value
    })
    this.context.globalState.update('versionCache', cacheData)
  }

  private triggerUpdateDecorations (editor: vscode.TextEditor, forceRefresh: boolean): void {
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout)
    }
    this.updateTimeout = setTimeout(() => {
      this.updateDecorations(editor, forceRefresh, false)
    }, 200)
  }

  private triggerUpdateDecorationsWithRetry (editor: vscode.TextEditor): void {
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout)
    }
    this.updateTimeout = setTimeout(() => {
      this.updateDecorations(editor, true, true)
    }, 200)
  }

  private async updateDecorations (editor: vscode.TextEditor, forceRefresh: boolean, retryErrors: boolean = false): Promise<void> {
    const document = editor.document
    const fileName = document.fileName

    // 检查是否是支持的文件
    if (!this.isSupportedFile(fileName)) {
      editor.setDecorations(this.decorationType, [])
      return
    }

    // 第一步：先用缓存快速显示
    const packages = this.extractPackages(document)
    const decorations = await this.createDecorationsFromCache(document, packages)
    editor.setDecorations(this.decorationType, decorations)

    // 第二步：后台获取最新版本并更新
    if (forceRefresh || this.hasExpiredCache(packages) || (retryErrors && this.hasErrorCache(packages))) {
      this.refreshVersionsInBackground(editor, packages, retryErrors)
    }
  }

  /** 提取文档中的所有包 */
  private extractPackages (document: vscode.TextDocument): Array<{
    line: number
    packageName: string
    packageValue: string
    lineText: string
  }> {
    const fileName = document.fileName
    const packages: Array<{
      line: number
      packageName: string
      packageValue: string
      lineText: string
    }> = []

    if (fileName.endsWith('pnpm-workspace.yaml')) {
      this.extractYamlPackages(document, packages)
    } else if (fileName.endsWith('package.json')) {
      this.extractJsonPackages(document, packages)
    }

    return packages
  }

  /** 从 YAML 提取包 */
  private extractYamlPackages (
    document: vscode.TextDocument,
    packages: Array<{ line: number; packageName: string; packageValue: string; lineText: string }>
  ): void {
    const text = document.getText()
    const lines = text.split('\n')

    let inCatalog = false
    let inCatalogs = false
    let catalogIndent = -1
    let subCatalogIndent = -1

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmed = line.trim()

      // 跳过空行和注释
      if (!trimmed || trimmed.startsWith('#')) {
        continue
      }

      // 计算当前缩进（使用空格数）
      const indentMatch = line.match(/^(\s*)/)
      const currentIndent = indentMatch ? indentMatch[1].length : 0

      // 检测 catalog: 区块
      if (trimmed === 'catalog:') {
        inCatalog = true
        inCatalogs = false
        catalogIndent = currentIndent
        subCatalogIndent = -1
        continue
      }

      // 检测 catalogs: 区块
      if (trimmed === 'catalogs:') {
        inCatalog = false
        inCatalogs = true
        catalogIndent = currentIndent
        subCatalogIndent = -1
        continue
      }

      // 检测顶层其他区块（packages: 等），退出 catalog
      if (currentIndent === 0 && trimmed.endsWith(':')) {
        inCatalog = false
        inCatalogs = false
        catalogIndent = -1
        subCatalogIndent = -1
        continue
      }

      // 在 catalogs 区块中，检测子 catalog（如 react18:）
      if (inCatalogs && catalogIndent >= 0) {
        // 子 catalog 的缩进应该是 catalogIndent + 2（或一个缩进单位）
        if (trimmed.endsWith(':') && !trimmed.includes(': ') && currentIndent > catalogIndent) {
          subCatalogIndent = currentIndent
          continue
        }
      }

      // 解析包依赖行
      const kvMatch = trimmed.match(/^([^:]+):\s*(.*)$/)
      if (kvMatch) {
        let packageName = kvMatch[1].trim()
        let packageValue = kvMatch[2].trim()

        // 移除包名的引号（scoped 包如 "@scope/name" 可能带引号）
        if ((packageName.startsWith('"') && packageName.endsWith('"')) ||
          (packageName.startsWith("'") && packageName.endsWith("'"))) {
          packageName = packageName.slice(1, -1)
        }

        // 移除版本的引号
        if ((packageValue.startsWith('"') && packageValue.endsWith('"')) ||
          (packageValue.startsWith("'") && packageValue.endsWith("'"))) {
          packageValue = packageValue.slice(1, -1)
        }

        // 判断是否是有效的包行
        let isValidPackage = false

        if (inCatalog && catalogIndent >= 0 && currentIndent > catalogIndent) {
          // 在 catalog: 区块中
          isValidPackage = true
        } else if (inCatalogs && subCatalogIndent >= 0 && currentIndent > subCatalogIndent) {
          // 在 catalogs: 的子 catalog 中
          isValidPackage = true
        }

        if (isValidPackage && packageName && packageValue !== '') {
          packages.push({
            line: i,
            packageName,
            packageValue,
            lineText: line,
          })
        }
      }
    }
  }

  /** 从 JSON 提取包 */
  private extractJsonPackages (
    document: vscode.TextDocument,
    packages: Array<{ line: number; packageName: string; packageValue: string; lineText: string }>
  ): void {
    try {
      const text = document.getText()
      const json = JSON.parse(text)
      const lines = text.split('\n')

      const depSections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

      for (const section of depSections) {
        if (json[section]) {
          for (const [packageName, version] of Object.entries(json[section])) {
            const versionStr = String(version)

            // 查找行号
            let inSection = false
            let braceCount = 0

            for (let i = 0; i < lines.length; i++) {
              const line = lines[i]

              if (line.includes(`"${section}"`)) {
                inSection = true
                braceCount = 0
              }

              if (inSection) {
                braceCount += (line.match(/{/g) || []).length
                braceCount -= (line.match(/}/g) || []).length

                if (line.includes(`"${packageName}"`)) {
                  packages.push({
                    line: i,
                    packageName,
                    packageValue: versionStr,
                    lineText: line,
                  })
                  break
                }

                if (braceCount <= 0 && i > 0) {
                  inSection = false
                }
              }
            }
          }
        }
      }
    } catch {
      // JSON 解析失败
    }
  }

  /** 检查是否有过期缓存 */
  private hasExpiredCache (packages: Array<{ packageName: string; packageValue: string }>): boolean {
    const now = Date.now()
    for (const pkg of packages) {
      const parsed = parsePackageValue(pkg.packageName, pkg.packageValue)
      const cacheKey = `${parsed.realPackageName}@${parsed.version}`
      const cached = this.versionCache.get(cacheKey)

      if (!cached || !cached.fetchedAt || now - cached.fetchedAt > CACHE_TTL) {
        return true
      }
    }
    return false
  }

  /** 检查是否有错误缓存 */
  private hasErrorCache (packages: Array<{ packageName: string; packageValue: string }>): boolean {
    for (const pkg of packages) {
      const parsed = parsePackageValue(pkg.packageName, pkg.packageValue)
      const cacheKey = `${parsed.realPackageName}@${parsed.version}`
      const cached = this.versionCache.get(cacheKey)

      if (cached && cached.status === VersionStatus.Error) {
        return true
      }
    }
    return false
  }

  /** 从缓存创建装饰 */
  private async createDecorationsFromCache (
    document: vscode.TextDocument,
    packages: Array<{ line: number; packageName: string; packageValue: string; lineText: string }>
  ): Promise<vscode.DecorationOptions[]> {
    const decorations: vscode.DecorationOptions[] = []

    for (const pkg of packages) {
      const statusInfo = await this.getVersionStatusFromCache(document, pkg.packageName, pkg.packageValue)
      const decoration = this.createDecoration(pkg.line, pkg.lineText, statusInfo)
      if (decoration) {
        decorations.push(decoration)
      }
    }

    return decorations
  }

  /** 从缓存获取版本状态（不发起网络请求） */
  private async getVersionStatusFromCache (
    document: vscode.TextDocument,
    packageName: string,
    version: string
  ): Promise<VersionStatusInfo> {
    // 处理 workspace: 协议 - 显示本地包信息
    if (version.startsWith('workspace:')) {
      // 使用异步方法，支持按需扫描
      const pkgInfo = await this.workspacePackageService?.getPackageInfoForFile(
        document.fileName,
        packageName
      )
      if (pkgInfo) {
        return {
          status: VersionStatus.Workspace,
          currentVersion: version,
          message: `${pkgInfo.relativePath}:${pkgInfo.version}`,
        }
      }
      return { status: VersionStatus.Workspace, currentVersion: version, message: '工作区引用' }
    }
    // 处理 catalog: 协议
    if (version.startsWith('catalog:')) {
      return { status: VersionStatus.Skipped, currentVersion: version, message: 'Catalog 引用' }
    }
    // 处理其他本地协议
    if (version.startsWith('link:') || version.startsWith('file:') || version.startsWith('git:') || version.startsWith('github:')) {
      return { status: VersionStatus.Skipped, currentVersion: version, message: '跳过检查' }
    }

    const parsed = parsePackageValue(packageName, version)
    const cacheKey = `${parsed.realPackageName}@${parsed.version}`
    const cached = this.versionCache.get(cacheKey)

    if (cached) {
      return cached
    }

    // 没有缓存，显示加载中
    return { status: VersionStatus.Loading, currentVersion: parsed.version, message: '检查中...' }
  }

  /** 后台刷新版本信息 */
  private async refreshVersionsInBackground (
    editor: vscode.TextEditor,
    packages: Array<{ line: number; packageName: string; packageValue: string; lineText: string }>,
    retryErrors: boolean = false
  ): Promise<void> {
    // 记录当前刷新的文档 URI
    const documentUri = editor.document.uri.toString()

    // 收集需要更新的包
    const packagesToFetch: Array<{ pkg: typeof packages[0]; cacheKey: string; parsed: ReturnType<typeof parsePackageValue> }> = []
    const now = Date.now()

    for (const pkg of packages) {
      // 跳过特殊协议
      if (pkg.packageValue.startsWith('workspace:') ||
        pkg.packageValue.startsWith('catalog:') ||
        pkg.packageValue.startsWith('link:') ||
        pkg.packageValue.startsWith('file:') ||
        pkg.packageValue.startsWith('git:') ||
        pkg.packageValue.startsWith('github:')) {
        continue
      }

      const parsed = parsePackageValue(pkg.packageName, pkg.packageValue)
      const cacheKey = `${parsed.realPackageName}@${parsed.version}`

      // 检查缓存
      const cached = this.versionCache.get(cacheKey)

      // 如果缓存未过期且不是错误状态（或者不需要重试错误），跳过
      if (cached && cached.fetchedAt && now - cached.fetchedAt < CACHE_TTL) {
        // 如果是错误状态且需要重试，则不跳过
        if (!(retryErrors && cached.status === VersionStatus.Error)) {
          continue
        }
      }

      packagesToFetch.push({ pkg, cacheKey, parsed })
    }

    // 并发获取所有包的版本，每获取到一个就立即更新显示
    const updateDecorationsNow = async () => {
      // 查找当前打开的匹配编辑器
      const currentEditor = vscode.window.visibleTextEditors.find(
        e => e.document.uri.toString() === documentUri
      )
      if (currentEditor) {
        const currentPackages = this.extractPackages(currentEditor.document)
        const decorations = await this.createDecorationsFromCache(currentEditor.document, currentPackages)
        currentEditor.setDecorations(this.decorationType, decorations)
      }
    }

    // 并行获取，但每完成一个就更新一次
    const fetchPromises = packagesToFetch.map(async ({ pkg, cacheKey, parsed }) => {
      const fetchTime = Date.now()
      try {
        const latestVersion = await this.npmService.getLatestVersion(parsed.realPackageName)

        let statusInfo: VersionStatusInfo
        if (!latestVersion) {
          logError(`获取 "${parsed.realPackageName}" 版本失败: 返回为空`)
          statusInfo = {
            status: VersionStatus.Error,
            currentVersion: parsed.version,
            message: '获取失败',
            fetchedAt: fetchTime,
          }
        } else if (!parsed.version) {
          statusInfo = {
            status: VersionStatus.Outdated,
            currentVersion: '',
            latestVersion,
            message: `最新: ${latestVersion}`,
            fetchedAt: fetchTime,
          }
        } else {
          const isLatest = this.compareVersions(parsed.version, latestVersion) >= 0
          statusInfo = {
            status: isLatest ? VersionStatus.Latest : VersionStatus.Outdated,
            currentVersion: parsed.version,
            latestVersion,
            message: isLatest ? '已是最新' : `最新: ${latestVersion}`,
            fetchedAt: fetchTime,
          }
        }

        this.versionCache.set(cacheKey, statusInfo)
      } catch (error) {
        // 获取失败，使用错误状态
        logError(`获取 "${parsed.realPackageName}" 版本失败`, error)
        this.versionCache.set(cacheKey, {
          status: VersionStatus.Error,
          currentVersion: parsed.version,
          message: '获取失败',
          fetchedAt: fetchTime,
        })
      }

      // 每获取到一个就立即更新装饰
      await updateDecorationsNow()
    })

    // 等待所有请求完成
    await Promise.all(fetchPromises)

    // 保存缓存
    if (packagesToFetch.length > 0) {
      this.saveCache()
    }
  }

  private isSupportedFile (fileName: string): boolean {
    return fileName.endsWith('pnpm-workspace.yaml') || fileName.endsWith('package.json')
  }

  /** 比较版本号 */
  private compareVersions (a: string, b: string): number {
    const parseVersion = (v: string) => {
      const match = v.match(/^(\d+)\.(\d+)\.(\d+)/)
      if (!match) return [0, 0, 0]
      return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])]
    }

    const [aMajor, aMinor, aPatch] = parseVersion(a)
    const [bMajor, bMinor, bPatch] = parseVersion(b)

    if (aMajor !== bMajor) return aMajor - bMajor
    if (aMinor !== bMinor) return aMinor - bMinor
    return aPatch - bPatch
  }

  /** 创建装饰 */
  private createDecoration (
    lineNumber: number,
    lineText: string,
    statusInfo: VersionStatusInfo
  ): vscode.DecorationOptions | null {
    const emoji = STATUS_EMOJI[statusInfo.status]
    const color = STATUS_COLORS[statusInfo.status]

    const range = new vscode.Range(
      lineNumber,
      lineText.length,
      lineNumber,
      lineText.length
    )

    let contentText = emoji
    if (statusInfo.message && statusInfo.status !== VersionStatus.Latest) {
      contentText = `${emoji} ${statusInfo.message}`
    }

    return {
      range,
      renderOptions: {
        after: {
          contentText,
          color,
        },
      },
    }
  }

  /** 清除缓存 */
  public clearCache (): void {
    this.versionCache.clear()
    if (this.context) {
      this.context.globalState.update('versionCache', undefined)
    }
    if (vscode.window.activeTextEditor) {
      this.triggerUpdateDecorations(vscode.window.activeTextEditor, true)
    }
  }

  dispose (): void {
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout)
    }
    this.saveCache()
    this.decorationType.dispose()
    this.disposables.forEach(d => d.dispose())
    if (outputChannel) {
      outputChannel.dispose()
      outputChannel = undefined
    }
  }
}
