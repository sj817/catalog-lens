import * as vscode from 'vscode'
import * as https from 'https'
import * as http from 'http'

interface PackageInfo {
  versions: string[]
  latestVersion: string
  fetchedAt: number
}

interface NpmRegistryResponse {
  'dist-tags'?: {
    latest?: string;
    [key: string]: string | undefined
  }
  versions?: {
    [version: string]: unknown
  }
}

export class NpmService {
  private cache: Map<string, PackageInfo> = new Map()
  private pendingRequests: Map<string, Promise<PackageInfo | null>> = new Map()
  private registryUrl: string | null
  private cacheTimeout: number
  private fastestRegistry: string | null = null

  /** 默认竞速的镜像源列表 */
  private static readonly DEFAULT_REGISTRIES = [
    'https://registry.npmjs.org',
    'https://registry.npmmirror.com',
  ]

  constructor () {
    this.registryUrl = this.getConfig<string | null>('registry', null)
    this.cacheTimeout = this.getConfig('cacheTimeout', 300000)
  }

  private getConfig<T> (key: string, defaultValue: T): T {
    const config = vscode.workspace.getConfiguration('catalogLens')
    return config.get<T>(key, defaultValue)
  }

  public updateConfig (): void {
    this.registryUrl = this.getConfig<string | null>('registry', null)
    this.cacheTimeout = this.getConfig('cacheTimeout', 300000)
    // 清除缓存以应用新配置
    this.cache.clear()
    this.fastestRegistry = null
  }

  /**
   * 清除缓存
   */
  public clearCache (): void {
    this.cache.clear()
    this.pendingRequests.clear()
  }

  /**
   * 获取包的所有版本
   */
  public async getPackageVersions (packageName: string): Promise<string[] | null> {
    const info = await this.getPackageInfo(packageName)
    return info?.versions || null
  }

  /**
   * 获取包的最新版本
   */
  public async getLatestVersion (packageName: string): Promise<string | null> {
    const info = await this.getPackageInfo(packageName)
    return info?.latestVersion || null
  }

  /**
   * 获取包信息（带缓存）
   */
  public async getPackageInfo (packageName: string): Promise<PackageInfo | null> {
    // 检查缓存
    const cached = this.cache.get(packageName)
    if (cached && Date.now() - cached.fetchedAt < this.cacheTimeout) {
      return cached
    }

    // 检查是否有正在进行的请求
    const pending = this.pendingRequests.get(packageName)
    if (pending) {
      return pending
    }

    // 发起新请求
    const request = this.fetchPackageInfo(packageName)
    this.pendingRequests.set(packageName, request)

    try {
      const result = await request
      if (result) {
        this.cache.set(packageName, result)
      }
      return result
    } finally {
      this.pendingRequests.delete(packageName)
    }
  }

  /**
   * 从 npm registry 获取包信息
   */
  private async fetchPackageInfo (packageName: string): Promise<PackageInfo | null> {
    // 如果有自定义镜像源，直接使用
    if (this.registryUrl) {
      return this.fetchFromRegistry(this.registryUrl, packageName)
    }

    // 如果已经探测到最快的源，直接使用
    if (this.fastestRegistry) {
      return this.fetchFromRegistry(this.fastestRegistry, packageName)
    }

    // 竞速：多个源同时请求，谁先返回用谁
    const promises = NpmService.DEFAULT_REGISTRIES.map(async (registry) => {
      const result = await this.fetchFromRegistry(registry, packageName)
      // 记录最快的源
      if (!this.fastestRegistry) {
        this.fastestRegistry = registry
      }
      return result
    })

    return Promise.any(promises)
  }

  /**
   * 从指定 registry 获取包信息
   */
  private fetchFromRegistry (registryUrl: string, packageName: string): Promise<PackageInfo> {
    return new Promise((resolve, reject) => {
      const url = `${registryUrl}/${encodeURIComponent(packageName).replace('%40', '@')}`
      const protocol = url.startsWith('https') ? https : http

      const request = protocol.get(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'vscode-pnpm-workspace-packages',
        },
        timeout: 10000,
      }, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage || 'Unknown error'} - ${url}`))
          return
        }

        let data = ''
        response.on('data', (chunk) => { data += chunk })
        response.on('end', () => {
          try {
            const json: NpmRegistryResponse = JSON.parse(data)
            const versions = Object.keys(json.versions || {})
              .filter(v => !v.includes('-')) // 过滤预发布版本
              .sort((a, b) => this.compareVersions(b, a)) // 降序排列

            const allVersions = Object.keys(json.versions || {})
              .sort((a, b) => this.compareVersions(b, a))

            const latestVersion = json['dist-tags']?.latest || versions[0] || ''

            resolve({
              versions: allVersions,
              latestVersion,
              fetchedAt: Date.now(),
            })
          } catch (e) {
            reject(new Error(`JSON 解析失败: ${e instanceof Error ? e.message : String(e)}`))
          }
        })
      })

      request.on('error', (e) => reject(new Error(`网络错误: ${e.message}`)))
      request.on('timeout', () => {
        request.destroy()
        reject(new Error(`请求超时: ${url}`))
      })
    })
  }

  /**
   * 比较两个版本号
   */
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
}
