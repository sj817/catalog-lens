import * as vscode from 'vscode'

/**
 * 检查文件是否是 pnpm-workspace.yaml
 */
export function isPnpmWorkspaceFile (document: vscode.TextDocument): boolean {
  return document.fileName.endsWith('pnpm-workspace.yaml')
}

/**
 * 检查文件是否是 package.json
 */
export function isPackageJsonFile (document: vscode.TextDocument): boolean {
  return document.fileName.endsWith('package.json')
}

/**
 * 在 YAML 文件中获取当前行的 key-value 信息
 */
export interface YamlLineInfo {
  /** 是否在 catalog 或 catalogs 区块中 */
  inCatalogSection: boolean
  /** 包名 (key) */
  packageName: string
  /** 包值 (value) */
  packageValue: string
  /** 值的范围 */
  valueRange: vscode.Range
  /** 当前光标是否在值的位置 */
  cursorInValue: boolean
  /** catalog 的名称 (用于 catalogs.xxx) */
  catalogName?: string
}

/**
 * 在 JSON 文件中获取当前行的 key-value 信息
 */
export interface JsonLineInfo {
  /** 是否在依赖区块中 */
  inDependencySection: boolean
  /** 依赖区块名称 */
  sectionName: string
  /** 包名 (key) */
  packageName: string
  /** 包值 (value) */
  packageValue: string
  /** 值的范围 */
  valueRange: vscode.Range
  /** 当前光标是否在值的位置 */
  cursorInValue: boolean
  /** 是否在 workspaces.catalog 区块中 */
  inWorkspaceCatalog?: boolean
}

/**
 * 解析当前位置的 YAML 行信息
 */
export function parseYamlLine (
  document: vscode.TextDocument,
  position: vscode.Position
): YamlLineInfo | null {
  const line = document.lineAt(position.line)
  const lineText = line.text

  // 检查是否是 key: value 格式
  const kvMatch = lineText.match(/^(\s*)([^:]+):\s*(.*)$/)
  if (!kvMatch) {
    return null
  }

  const [, indent, key, value] = kvMatch
  const indentLevel = indent.length

  // 检查是否在 catalog 区块中
  const catalogInfo = findCatalogSection(document, position.line, indentLevel)
  if (!catalogInfo.inCatalog) {
    return null
  }

  // 计算值的范围
  const keyEndIndex = lineText.indexOf(':') + 1
  const valueStartIndex = keyEndIndex + (lineText.slice(keyEndIndex).match(/^\s*/)?.[0].length || 0)
  const valueEndIndex = lineText.length

  // 处理引号
  let actualValue = value.trim()
  let valueStart = valueStartIndex
  let valueEnd = valueEndIndex

  if ((actualValue.startsWith('"') && actualValue.endsWith('"')) ||
    (actualValue.startsWith("'") && actualValue.endsWith("'"))) {
    actualValue = actualValue.slice(1, -1)
    valueStart = lineText.indexOf(actualValue, keyEndIndex)
    valueEnd = valueStart + actualValue.length
  }

  const valueRange = new vscode.Range(
    position.line, valueStart,
    position.line, valueEnd
  )

  return {
    inCatalogSection: true,
    packageName: key.trim(),
    packageValue: actualValue,
    valueRange,
    cursorInValue: position.character >= valueStart,
    catalogName: catalogInfo.catalogName,
  }
}

/**
 * 查找当前行是否在 catalog 区块中
 */
function findCatalogSection (
  document: vscode.TextDocument,
  lineNumber: number,
  currentIndent: number
): { inCatalog: boolean; catalogName?: string } {
  // 向上查找 catalog: 或 catalogs: 开头的行
  for (let i = lineNumber - 1; i >= 0; i--) {
    const line = document.lineAt(i).text

    // 跳过空行和注释
    if (!line.trim() || line.trim().startsWith('#')) {
      continue
    }

    const lineIndent = line.match(/^(\s*)/)?.[1].length || 0

    // 如果找到同级或更低缩进的非 catalog 行，说明不在 catalog 区块中
    if (lineIndent < currentIndent) {
      // 检查是否是 catalog: 行
      if (line.trim() === 'catalog:' || line.trim().startsWith('catalog:')) {
        return { inCatalog: true }
      }

      // 检查是否是 catalogs 下的子 catalog
      const catalogNameMatch = line.match(/^(\s*)(\w+):$/)
      if (catalogNameMatch && lineIndent > 0) {
        // 继续向上查找 catalogs:
        for (let j = i - 1; j >= 0; j--) {
          const parentLine = document.lineAt(j).text
          if (parentLine.trim() === 'catalogs:') {
            return { inCatalog: true, catalogName: catalogNameMatch[2] }
          }
          if (parentLine.trim() && !parentLine.trim().startsWith('#')) {
            const parentIndent = parentLine.match(/^(\s*)/)?.[1].length || 0
            if (parentIndent < lineIndent) {
              break
            }
          }
        }
      }

      // 不在 catalog 区块中
      return { inCatalog: false }
    }
  }

  return { inCatalog: false }
}

/**
 * 获取值的完整范围（包括引号）
 */
export function getFullValueRange (
  document: vscode.TextDocument,
  position: vscode.Position
): vscode.Range | null {
  const line = document.lineAt(position.line)
  const lineText = line.text

  const colonIndex = lineText.indexOf(':')
  if (colonIndex === -1) {
    return null
  }

  const afterColon = lineText.slice(colonIndex + 1)
  const valueMatch = afterColon.match(/^(\s*)(["']?)(.*)(\2)\s*$/)

  if (!valueMatch) {
    return null
  }

  const [, spaces] = valueMatch
  const startIndex = colonIndex + 1 + spaces.length
  const endIndex = lineText.length - (lineText.endsWith(' ') ? lineText.length - lineText.trimEnd().length : 0)

  return new vscode.Range(position.line, startIndex, position.line, endIndex)
}

/**
 * 解析 package.json 当前位置的行信息
 */
export function parseJsonLine (
  document: vscode.TextDocument,
  position: vscode.Position
): JsonLineInfo | null {
  const line = document.lineAt(position.line)
  const lineText = line.text

  // 检查是否是 "key": "value" 格式
  const kvMatch = lineText.match(/^\s*"([^"]+)"\s*:\s*"([^"]*)"/)
  if (!kvMatch) {
    return null
  }

  const packageName = kvMatch[1]
  const packageValue = kvMatch[2]

  // 检查是否在依赖区块中
  const sectionInfo = findDependencySection(document, position.line)

  // 检查是否在 workspaces.catalog 区块中 (Bun/PNPM catalog)
  const catalogInfo = findWorkspaceCatalogSection(document, position.line)
  const inCatalog = catalogInfo.inCatalog

  if (!sectionInfo.inSection && !inCatalog) {
    return null
  }

  // 计算值的范围 (引号内的内容)
  const valueMatch = lineText.match(/:\s*"([^"]*)"/)
  if (!valueMatch) {
    return null
  }

  const valueStartIndex = lineText.indexOf(valueMatch[0]) + valueMatch[0].indexOf('"', 1) + 1
  const valueEndIndex = lineText.lastIndexOf('"')

  const valueRange = new vscode.Range(
    position.line, valueStartIndex,
    position.line, valueEndIndex
  )

  return {
    inDependencySection: sectionInfo.inSection,
    sectionName: sectionInfo.sectionName || '',
    packageName,
    packageValue,
    valueRange,
    cursorInValue: position.character >= valueStartIndex && position.character <= valueEndIndex,
    inWorkspaceCatalog: inCatalog,
  }
}

/**
 * 查找当前行是否在依赖区块中
 */
function findDependencySection (
  document: vscode.TextDocument,
  lineNumber: number
): { inSection: boolean; sectionName?: string } {
  const depSections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

  let braceCount = 0

  // 向上查找依赖区块
  for (let i = lineNumber; i >= 0; i--) {
    const line = document.lineAt(i).text

    // 计算括号
    braceCount += (line.match(/}/g) || []).length
    braceCount -= (line.match(/{/g) || []).length

    // 如果括号匹配完毕，说明已经离开当前区块
    if (braceCount > 0 && i < lineNumber) {
      break
    }

    // 检查是否是依赖区块开始
    for (const section of depSections) {
      if (line.includes(`"${section}"`)) {
        return { inSection: true, sectionName: section }
      }
    }
  }

  return { inSection: false }
}

/**
 * 查找当前行是否在 workspaces.catalog 区块中 (Bun/PNPM)
 */
function findWorkspaceCatalogSection (
  document: vscode.TextDocument,
  lineNumber: number
): { inCatalog: boolean } {
  let braceCount = 0
  let foundCatalog = false

  // 向上查找 workspaces.catalog 区块
  for (let i = lineNumber; i >= 0; i--) {
    const line = document.lineAt(i).text

    // 计算括号
    braceCount += (line.match(/}/g) || []).length
    braceCount -= (line.match(/{/g) || []).length

    // 如果括号匹配完毕，说明已经离开当前区块
    if (braceCount > 0 && i < lineNumber) {
      break
    }

    // 向上搜索时先遇到 catalog 再遇到 workspaces
    if (!foundCatalog && /"catalog"\s*:/.test(line)) {
      foundCatalog = true
    }

    // 找到 catalog 后继续向上查找 workspaces
    if (foundCatalog && /"workspaces"\s*:/.test(line)) {
      return { inCatalog: true }
    }
  }

  return { inCatalog: false }
}
