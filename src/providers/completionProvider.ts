import * as vscode from 'vscode'
import { NpmService } from '../services/npmService'
import { parseYamlLine, parseJsonLine } from '../utils/fileUtils'
import { parsePackageValue, formatVersionWithPrefix, buildAliasValue, VersionPrefix } from '../utils/versionParser'

export class CompletionProvider implements vscode.CompletionItemProvider {
  constructor (private npmService: NpmService) {}

  async provideCompletionItems (
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext
  ): Promise<vscode.CompletionItem[] | null> {
    const fileName = document.fileName

    if (fileName.endsWith('pnpm-workspace.yaml')) {
      return this.provideYamlCompletions(document, position)
    } else if (fileName.endsWith('package.json')) {
      return this.provideJsonCompletions(document, position)
    }

    return null
  }

  /** 为 YAML 文件提供补全 */
  private async provideYamlCompletions (
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.CompletionItem[] | null> {
    const lineInfo = parseYamlLine(document, position)
    if (!lineInfo || !lineInfo.inCatalogSection) {
      return null
    }

    const { packageName, packageValue, valueRange } = lineInfo
    const parsed = parsePackageValue(packageName, packageValue)

    // 获取包的版本列表
    const versions = await this.npmService.getPackageVersions(parsed.realPackageName)
    if (!versions || versions.length === 0) {
      return null
    }

    const completionItems: vscode.CompletionItem[] = []

    // 根据不同情况生成补全项
    if (parsed.isAlias) {
      completionItems.push(...this.createAliasCompletionItems(
        parsed.realPackageName,
        versions,
        parsed.versionPrefix,
        valueRange
      ))
    } else {
      completionItems.push(...this.createVersionCompletionItems(
        versions,
        parsed.versionPrefix,
        valueRange
      ))
    }

    return completionItems
  }

  /** 为 package.json 文件提供补全 */
  private async provideJsonCompletions (
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.CompletionItem[] | null> {
    const lineInfo = parseJsonLine(document, position)
    if (!lineInfo || !lineInfo.inDependencySection) {
      return null
    }

    const { packageName, packageValue, valueRange } = lineInfo

    // 跳过 workspace:* 等 pnpm 协议
    if (this.isPnpmProtocol(packageValue)) {
      return null
    }

    const parsed = parsePackageValue(packageName, packageValue)

    // 获取包的版本列表
    const versions = await this.npmService.getPackageVersions(parsed.realPackageName)
    if (!versions || versions.length === 0) {
      return null
    }

    return this.createVersionCompletionItems(versions, parsed.versionPrefix, valueRange)
  }

  /** 检查是否是 pnpm 协议 */
  private isPnpmProtocol (value: string): boolean {
    return value.startsWith('workspace:') ||
           value.startsWith('link:') ||
           value.startsWith('file:') ||
           value.startsWith('git:') ||
           value.startsWith('github:')
  }

  /**
   * 创建别名格式的补全项
   */
  private createAliasCompletionItems (
    packageName: string,
    versions: string[],
    currentPrefix: VersionPrefix,
    range: vscode.Range
  ): vscode.CompletionItem[] {
    const items: vscode.CompletionItem[] = []
    const prefixes: VersionPrefix[] = currentPrefix ? [currentPrefix] : ['', '^', '~']
    const limitedVersions = versions.slice(0, 30)

    for (const version of limitedVersions) {
      for (const prefix of prefixes) {
        const newValue = buildAliasValue(packageName, version, prefix)
        const item = new vscode.CompletionItem(
          newValue,
          vscode.CompletionItemKind.Value
        )

        item.detail = version === versions[0] ? '(最新版本)' : undefined
        item.sortText = this.getSortText(versions.indexOf(version), prefix)
        item.insertText = newValue
        item.range = range

        if (version === versions[0]) {
          item.preselect = true
        }

        items.push(item)
      }
    }

    return items
  }

  /**
   * 创建直接版本格式的补全项
   */
  private createVersionCompletionItems (
    versions: string[],
    currentPrefix: VersionPrefix,
    range: vscode.Range
  ): vscode.CompletionItem[] {
    const items: vscode.CompletionItem[] = []
    const prefixes: VersionPrefix[] = currentPrefix ? [currentPrefix] : ['', '^', '~']
    const limitedVersions = versions.slice(0, 30)

    for (const version of limitedVersions) {
      for (const prefix of prefixes) {
        const newValue = formatVersionWithPrefix(version, prefix)
        const item = new vscode.CompletionItem(
          newValue,
          vscode.CompletionItemKind.Value
        )

        item.detail = version === versions[0] ? '(最新版本)' : undefined
        item.sortText = this.getSortText(versions.indexOf(version), prefix)
        item.insertText = newValue
        item.range = range

        if (version === versions[0]) {
          item.preselect = true
        }

        items.push(item)
      }
    }

    return items
  }

  /**
   * 生成排序文本
   */
  private getSortText (versionIndex: number, prefix: VersionPrefix): string {
    const prefixOrder = prefix === '' ? '0' : prefix === '^' ? '1' : '2'
    return `${String(versionIndex).padStart(5, '0')}-${prefixOrder}`
  }
}
