/**
 * 解析包值的结果
 */
export interface ParsedPackageValue {
  /** 原始值 */
  raw: string;
  /** 是否是别名格式 (npm:xxx) */
  isAlias: boolean;
  /** 实际的包名（别名解析后的真实包名） */
  realPackageName: string;
  /** 版本号（不含前缀） */
  version: string;
  /** 版本前缀 (^, ~, >=, 等) */
  versionPrefix: VersionPrefix;
  /** 是否有版本号 */
  hasVersion: boolean;
  /** 是否是完整的版本号 */
  isCompleteVersion: boolean;
}

/**
 * 版本前缀列表
 */
export const VERSION_PREFIXES = ['^', '~', '>=', '<=', '>', '<', '='] as const
export type VersionPrefix = '^' | '~' | '>=' | '<=' | '>' | '<' | '=' | ''

/**
 * 解析 pnpm-workspace.yaml 中的包值
 *
 * 支持的格式:
 * - 直接版本号: "1.0.0", "^1.0.0", "~1.0.0"
 * - 别名无版本: "npm:@karinjs/axios"
 * - 别名带版本: "npm:@karinjs/axios@1.0.0"
 * - 空值或只有前缀: "", "^"
 */
export function parsePackageValue (key: string, value: string): ParsedPackageValue {
  const raw = value.trim()

  // 检查是否是别名格式
  if (raw.startsWith('npm:')) {
    return parseAliasValue(key, raw)
  }

  // 普通版本格式
  return parseVersionValue(key, raw)
}

/**
 * 解析别名格式的值
 * 格式: npm:@scope/package[@version]
 */
function parseAliasValue (key: string, value: string): ParsedPackageValue {
  // 移除 "npm:" 前缀
  const aliasContent = value.slice(4)

  // 查找版本号分隔符 @
  // 需要处理 @scope/package@version 的情况
  let atIndex = -1
  if (aliasContent.startsWith('@')) {
    // @scope/package 格式，找第二个 @
    atIndex = aliasContent.indexOf('@', 1)
  } else {
    // 普通包名格式
    atIndex = aliasContent.indexOf('@')
  }

  if (atIndex === -1) {
    // 无版本号的别名
    return {
      raw: value,
      isAlias: true,
      realPackageName: aliasContent,
      version: '',
      versionPrefix: '',
      hasVersion: false,
      isCompleteVersion: false,
    }
  }

  // 有版本号的别名
  const packageName = aliasContent.slice(0, atIndex)
  const versionPart = aliasContent.slice(atIndex + 1)
  const { prefix, version } = extractPrefixAndVersion(versionPart)

  return {
    raw: value,
    isAlias: true,
    realPackageName: packageName,
    version,
    versionPrefix: prefix,
    hasVersion: version.length > 0,
    isCompleteVersion: isCompleteVersion(version),
  }
}

/**
 * 解析普通版本格式的值
 */
function parseVersionValue (key: string, value: string): ParsedPackageValue {
  const { prefix, version } = extractPrefixAndVersion(value)

  return {
    raw: value,
    isAlias: false,
    realPackageName: key,
    version,
    versionPrefix: prefix,
    hasVersion: version.length > 0,
    isCompleteVersion: isCompleteVersion(version),
  }
}

/**
 * 提取版本前缀和版本号
 */
function extractPrefixAndVersion (value: string): { prefix: VersionPrefix; version: string } {
  for (const prefix of VERSION_PREFIXES) {
    if (value.startsWith(prefix)) {
      return {
        prefix,
        version: value.slice(prefix.length),
      }
    }
  }
  return { prefix: '', version: value }
}

/**
 * 检查是否是完整的版本号
 * 完整版本号格式: major.minor.patch 或 major.minor.patch-prerelease
 */
function isCompleteVersion (version: string): boolean {
  if (!version) return false
  // 匹配 semver 格式
  return /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)
}

/**
 * 将版本号转换为带前缀的格式
 */
export function formatVersionWithPrefix (version: string, prefix: VersionPrefix): string {
  return prefix + version
}

/**
 * 为别名格式构建完整的值
 */
export function buildAliasValue (packageName: string, version: string, prefix: VersionPrefix): string {
  if (!version) {
    return `npm:${packageName}`
  }
  return `npm:${packageName}@${prefix}${version}`
}
