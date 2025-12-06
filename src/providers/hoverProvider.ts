import * as vscode from 'vscode'
import { NpmService } from '../services/npmService'
import { parseYamlLine, parseJsonLine } from '../utils/fileUtils'
import { parsePackageValue, VersionPrefix } from '../utils/versionParser'

export class HoverProvider implements vscode.HoverProvider {
  constructor (private npmService: NpmService) {}

  async provideHover (
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Hover | null> {
    const fileName = document.fileName

    if (fileName.endsWith('pnpm-workspace.yaml')) {
      return this.provideYamlHover(document, position)
    } else if (fileName.endsWith('package.json')) {
      return this.provideJsonHover(document, position)
    }

    return null
  }

  /** 为 YAML 文件提供悬停 */
  private async provideYamlHover (
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Hover | null> {
    const lineInfo = parseYamlLine(document, position)
    if (!lineInfo || !lineInfo.inCatalogSection || !lineInfo.cursorInValue) {
      return null
    }

    const { packageName, packageValue, valueRange } = lineInfo
    return this.createHover(packageName, packageValue, valueRange)
  }

  /** 为 JSON 文件提供悬停 */
  private async provideJsonHover (
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Hover | null> {
    const lineInfo = parseJsonLine(document, position)
    if (!lineInfo || !lineInfo.inDependencySection || !lineInfo.cursorInValue) {
      return null
    }

    const { packageName, packageValue, valueRange } = lineInfo

    // 跳过 workspace:* 等 pnpm 协议
    if (this.isPnpmProtocol(packageValue)) {
      return new vscode.Hover(
        new vscode.MarkdownString(`🔗 **工作区引用**: \`${packageValue}\``)
      )
    }

    return this.createHover(packageName, packageValue, valueRange)
  }

  /** 检查是否是 pnpm 协议 */
  private isPnpmProtocol (value: string): boolean {
    return value.startsWith('workspace:') ||
           value.startsWith('link:') ||
           value.startsWith('file:') ||
           value.startsWith('git:') ||
           value.startsWith('github:')
  }

  /** 创建悬停内容 */
  private async createHover (
    packageName: string,
    packageValue: string,
    valueRange: vscode.Range
  ): Promise<vscode.Hover | null> {
    const parsed = parsePackageValue(packageName, packageValue)

    // 获取包信息
    const [latestVersion, versions] = await Promise.all([
      this.npmService.getLatestVersion(parsed.realPackageName),
      this.npmService.getPackageVersions(parsed.realPackageName),
    ])

    if (!latestVersion || !versions) {
      return new vscode.Hover(
        new vscode.MarkdownString(`⚠️ 无法获取 **${parsed.realPackageName}** 的版本信息`)
      )
    }

    // 构建 Hover 内容
    const markdown = this.buildHoverContent(
      parsed.realPackageName,
      parsed.version,
      parsed.versionPrefix,
      latestVersion,
      versions,
      parsed.isAlias,
      valueRange
    )

    return new vscode.Hover(markdown, valueRange)
  }

  /**
   * 构建 Hover 显示内容
   */
  private buildHoverContent (
    packageName: string,
    currentVersion: string,
    currentPrefix: VersionPrefix,
    latestVersion: string,
    versions: string[],
    isAlias: boolean,
    valueRange: vscode.Range
  ): vscode.MarkdownString {
    const md = new vscode.MarkdownString()
    md.isTrusted = true
    md.supportHtml = true

    // 包名和当前版本信息
    md.appendMarkdown(`### 📦 ${packageName}\n\n`)

    if (currentVersion) {
      const isLatest = currentVersion === latestVersion
      if (isLatest) {
        md.appendMarkdown(`✅ 当前版本: **${currentPrefix}${currentVersion}** (已是最新)\n\n`)
      } else {
        md.appendMarkdown(`📌 当前版本: **${currentPrefix}${currentVersion}**\n\n`)
        md.appendMarkdown(`🚀 最新版本: **${latestVersion}**\n\n`)

        // 添加快速更新按钮
        const updateCommand = this.createUpdateCommand(
          packageName,
          latestVersion,
          valueRange,
          currentPrefix,
          isAlias
        )
        md.appendMarkdown(`[⬆️ 更新到最新版本](${updateCommand})\n\n`)
      }
    } else {
      md.appendMarkdown(`🚀 最新版本: **${latestVersion}**\n\n`)
    }

    // 版本选择按钮
    const selectCommand = encodeURIComponent(JSON.stringify([
      packageName,
      currentVersion,
      currentPrefix,
      isAlias,
      {
        start: { line: valueRange.start.line, character: valueRange.start.character },
        end: { line: valueRange.end.line, character: valueRange.end.character },
      },
    ]))
    md.appendMarkdown(`[📋 选择其他版本](command:catalogLens.selectVersion?${selectCommand})\n\n`)

    // 最近版本列表
    md.appendMarkdown('---\n\n')
    md.appendMarkdown('**最近版本:**\n\n')

    const recentVersions = versions.slice(0, 10)
    for (const version of recentVersions) {
      const isLatest = version === latestVersion
      const isCurrent = version === currentVersion
      let marker = ''
      if (isLatest) marker = ' 🔥'
      if (isCurrent) marker += ' ✓'
      md.appendMarkdown(`- \`${version}\`${marker}\n`)
    }

    if (versions.length > 10) {
      md.appendMarkdown(`\n*...还有 ${versions.length - 10} 个版本*\n`)
    }

    // npm 链接
    md.appendMarkdown('\n---\n\n')
    md.appendMarkdown(`[🔗 在 npm 上查看](https://www.npmjs.com/package/${encodeURIComponent(packageName)})`)

    return md
  }

  /**
   * 创建更新命令 URI
   */
  private createUpdateCommand (
    packageName: string,
    latestVersion: string,
    range: vscode.Range,
    prefix: VersionPrefix,
    isAlias: boolean
  ): string {
    const args = encodeURIComponent(JSON.stringify([
      packageName,
      latestVersion,
      prefix,
      isAlias,
      {
        start: { line: range.start.line, character: range.start.character },
        end: { line: range.end.line, character: range.end.character },
      },
    ]))
    return `command:catalogLens.updateToLatest?${args}`
  }
}
