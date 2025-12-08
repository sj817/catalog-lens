import * as vscode from 'vscode'
import { CompletionProvider } from './providers/completionProvider'
import { HoverProvider } from './providers/hoverProvider'
import { VersionDecorationProvider } from './providers/decorationProvider'
import { NpmService } from './services/npmService'
import { WorkspacePackageService } from './services/workspacePackageService'

// 全局日志通道
export let outputChannel: vscode.OutputChannel

export function activate (context: vscode.ExtensionContext) {
  // 创建日志通道
  outputChannel = vscode.window.createOutputChannel('Package Lens')
  context.subscriptions.push(outputChannel)
  
  outputChannel.appendLine('Package Lens 插件已激活')

  const npmService = new NpmService()
  const workspacePackageService = new WorkspacePackageService(context)
  context.subscriptions.push(workspacePackageService)

  // 文档选择器 - pnpm-workspace.yaml 文件
  const yamlSelector: vscode.DocumentSelector = {
    language: 'yaml',
    pattern: '**/pnpm-workspace.yaml',
  }

  // 文档选择器 - package.json 文件
  const jsonSelector: vscode.DocumentSelector = {
    language: 'json',
    pattern: '**/package.json',
  }

  // 注册自动补全提供者 - YAML
  const completionProvider = new CompletionProvider(npmService)
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      yamlSelector,
      completionProvider,
      ':', '"', "'", '^', '~', '@', '.', ' ' // 触发字符，添加空格以支持空值
    )
  )

  // 注册自动补全提供者 - JSON
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      jsonSelector,
      completionProvider,
      ':', '"', '^', '~', '@', '.'
    )
  )

  // 注册悬停提供者 - YAML
  const hoverProvider = new HoverProvider(npmService, workspacePackageService)
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(yamlSelector, hoverProvider)
  )

  // 注册悬停提供者 - JSON
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(jsonSelector, hoverProvider)
  )

  // 注册版本装饰器（传入 context 以支持持久化缓存）
  const decorationProvider = new VersionDecorationProvider(npmService, context, workspacePackageService)
  context.subscriptions.push(decorationProvider)

  // 注册命令：选择版本
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'packageLens.selectVersion',
      async (
        packageName: string,
        currentVersion: string,
        prefix: string,
        isAlias: boolean,
        rangeData: { start: { line: number; character: number }; end: { line: number; character: number } }
      ) => {
        const versions = await npmService.getPackageVersions(packageName)
        if (!versions || versions.length === 0) {
          vscode.window.showErrorMessage(`无法获取 ${packageName} 的版本信息`)
          return
        }

        // 从序列化数据重建 Range
        const range = new vscode.Range(
          rangeData.start.line,
          rangeData.start.character,
          rangeData.end.line,
          rangeData.end.character
        )

        // 创建快速选择项
        const latestVersion = versions[0]
        const items = versions.slice(0, 50).map(v => {
          // 根据是否是别名格式构建显示的标签
          const displayLabel = isAlias
            ? `npm:${packageName}@${prefix}${v}`
            : `${prefix}${v}`

          // 根据前缀生成描述
          let description = ''
          if (v === latestVersion) {
            description = '(最新版本)'
          }

          // 根据前缀添加语义说明
          let detail = ''
          if (prefix === '^') {
            // ^ 匹配主版本号
            const majorMatch = v.match(/^(\d+)\./)
            if (majorMatch) {
              detail = `匹配 ${majorMatch[1]}.x.x (兼容更新)`
            }
          } else if (prefix === '~') {
            // ~ 匹配次版本号
            const minorMatch = v.match(/^(\d+\.\d+)\./)
            if (minorMatch) {
              detail = `匹配 ${minorMatch[1]}.x (补丁更新)`
            }
          } else if (prefix === '' || prefix === '=') {
            detail = '锁定此版本'
          }

          return {
            label: displayLabel,
            description,
            detail,
            version: v,
          }
        })

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: `选择 ${packageName} 的版本`,
        })

        if (selected) {
          const editor = vscode.window.activeTextEditor
          if (editor) {
            await editor.edit(editBuilder => {
              editBuilder.replace(range, selected.label)
            })
          }
        }
      }
    )
  )

  // 注册命令：刷新缓存
  context.subscriptions.push(
    vscode.commands.registerCommand('packageLens.refreshCache', () => {
      npmService.clearCache()
      decorationProvider.clearCache()
      vscode.window.showInformationMessage('版本缓存已刷新')
    })
  )

  // 注册命令：直接更新到最新版本
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'packageLens.updateToLatest',
      async (
        packageName: string,
        latestVersion: string,
        prefix: string,
        isAlias: boolean,
        rangeData: { start: { line: number; character: number }; end: { line: number; character: number } }
      ) => {
        const editor = vscode.window.activeTextEditor
        if (!editor) {
          return
        }

        // 从序列化数据重建 Range
        const range = new vscode.Range(
          rangeData.start.line,
          rangeData.start.character,
          rangeData.end.line,
          rangeData.end.character
        )

        // 构建新的值
        let newValue: string
        if (isAlias) {
          // 别名格式: npm:@scope/package@version
          newValue = `npm:${packageName}@${prefix}${latestVersion}`
        } else {
          // 普通格式: ^version
          newValue = `${prefix}${latestVersion}`
        }

        await editor.edit(editBuilder => {
          editBuilder.replace(range, newValue)
        })
      }
    )
  )

  // 监听配置变化
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('packageLens')) {
        npmService.updateConfig()
      }
    })
  )
}

export function deactivate () {
  outputChannel?.appendLine('Package Lens 插件已停用')
}
