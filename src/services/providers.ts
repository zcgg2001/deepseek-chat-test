import { create } from 'zustand'
import { ApiError, listModels } from './api/client.js'
import { translate } from '../i18n/index.js'

/** 兼容协议：Anthropic 的 /messages 或 OpenAI 的 /chat/completions */
export type ProviderProtocol = 'anthropic' | 'openai'

/** 用户自行添加的模型提供商 */
export type CustomProvider = {
  /** 路由 id，唯一，用于选择与持久化 */
  id: string
  /** 展示名 */
  name: string
  /** 接口根地址，例如 https://api.example.com/anthropic/v1 */
  baseUrl: string
  protocol: ProviderProtocol
  apiKey: string
  /** 该提供商下可选用的模型 id */
  models: string[]
  /** 只有启用的提供商会出现在模型选择器里 */
  enabled: boolean
}

const KEY = 'chat-demo:providers'

const createId = () => `p_${Math.random().toString(36).slice(2, 10)}`

const read = (): CustomProvider[] => {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed
      .filter((item): item is CustomProvider => Boolean(item) && typeof item === 'object')
      .map((item) => ({
        id: typeof item.id === 'string' && item.id ? item.id : createId(),
        name: typeof item.name === 'string' ? item.name : '',
        baseUrl: typeof item.baseUrl === 'string' ? item.baseUrl : '',
        protocol: item.protocol === 'openai' ? 'openai' : 'anthropic',
        apiKey: typeof item.apiKey === 'string' ? item.apiKey : '',
        models: Array.isArray(item.models)
          ? item.models.filter((model): model is string => typeof model === 'string')
          : [],
        enabled: item.enabled !== false,
      }))
  } catch {
    return []
  }
}

const write = (providers: CustomProvider[]) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(providers))
  } catch {
    // 存储不可用时只保留内存状态
  }
}

/**
 * 内置预置提供商：每次进入页面都保证存在（被删除或旧版本缺失时自动补回），
 * 地址、协议、名称固定；用户只需填写 API Key，模型列表由 GET /models 自动获取。
 */
export const PRESET_PROVIDER_ID = 'p_505zc_codex'

const PRESET_PROVIDER: CustomProvider = {
  id: PRESET_PROVIDER_ID,
  name: '505zc Codex',
  // 该端点的 CORS 只放行 Authorization，浏览器里只能走 OpenAI /chat/completions
  baseUrl: 'https://codex.505zc.tech/v1',
  protocol: 'openai',
  apiKey: '',
  models: [],
  enabled: true,
}

export const isPresetProvider = (id: string) => id === PRESET_PROVIDER_ID

/** 预置项放在最前；保留用户填的 Key、已获取的模型与启用开关，其余字段始终用内置值 */
const ensurePreset = (providers: CustomProvider[]): CustomProvider[] => {
  const saved = providers.find((provider) => provider.id === PRESET_PROVIDER_ID)
  const preset: CustomProvider = {
    ...PRESET_PROVIDER,
    apiKey: saved?.apiKey ?? '',
    models: saved?.models ?? [],
    enabled: saved?.enabled ?? true,
  }
  return [preset, ...providers.filter((provider) => provider.id !== PRESET_PROVIDER_ID)]
}

type ModelFetch = { status: 'idle' | 'loading' | 'done' | 'error'; error?: string }

type State = {
  providers: CustomProvider[]
  /** 各提供商「按 Key 获取模型列表」的进度，只存内存 */
  modelFetch: Record<string, ModelFetch>
}

export const useProviders = create<State>(() => {
  const providers = ensurePreset(read())
  write(providers)
  return { providers, modelFetch: {} }
})

const commit = (providers: CustomProvider[]) => {
  const next = ensurePreset(providers)
  write(next)
  useProviders.setState({ providers: next })
}

/** 新增一个空提供商，返回它的 id */
export const addProvider = (): string => {
  const provider: CustomProvider = {
    id: createId(),
    name: '',
    baseUrl: '',
    protocol: 'anthropic',
    apiKey: '',
    models: [],
    enabled: true,
  }
  commit([...useProviders.getState().providers, provider])
  return provider.id
}

export const updateProvider = (id: string, patch: Partial<Omit<CustomProvider, 'id'>>) => {
  commit(
    useProviders.getState().providers.map((provider) =>
      provider.id === id ? { ...provider, ...patch } : provider
    )
  )
}

export const removeProvider = (id: string) => {
  // 预置提供商不可删除（commit 也会补回）；清空 Key 即可停用它的请求
  if (isPresetProvider(id)) {
    return
  }
  commit(useProviders.getState().providers.filter((provider) => provider.id !== id))
}

const setModelFetch = (id: string, value: ModelFetch) =>
  useProviders.setState((state) => ({ modelFetch: { ...state.modelFetch, [id]: value } }))

/** 每个提供商只保留最新一次获取，旧请求的结果直接丢弃 */
const modelFetchControllers = new Map<string, AbortController>()

/**
 * 用提供商当前的 Key 调 GET /models，把返回的全部模型写进它的模型列表。
 * 没有 Key 时清空模型列表；失败时保留原列表并记录错误原文。
 */
export const refreshProviderModels = async (id: string): Promise<void> => {
  modelFetchControllers.get(id)?.abort()
  const provider = useProviders.getState().providers.find((item) => item.id === id)
  if (!provider) {
    return
  }
  const apiKey = provider.apiKey.trim()
  if (!apiKey || !provider.baseUrl.trim()) {
    if (isPresetProvider(id)) {
      updateProvider(id, { models: [] })
    }
    setModelFetch(id, { status: 'idle' })
    return
  }
  const controller = new AbortController()
  modelFetchControllers.set(id, controller)
  setModelFetch(id, { status: 'loading' })
  try {
    const models = await listModels(apiKey, provider.baseUrl.trim(), controller.signal)
    if (controller.signal.aborted) {
      return
    }
    updateProvider(id, { models })
    setModelFetch(id, { status: 'done' })
  } catch (error) {
    if (controller.signal.aborted) {
      return
    }
    const message =
      error instanceof ApiError
        ? error.message || translate('providerModelsFetchFailed')
        : translate('providerModelsFetchFailed')
    setModelFetch(id, { status: 'error', error: message })
  } finally {
    if (modelFetchControllers.get(id) === controller) {
      modelFetchControllers.delete(id)
    }
  }
}

/** 输入 Key 时防抖后自动获取模型列表 */
const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>()

export const scheduleProviderModelsRefresh = (id: string, delay = 600) => {
  clearTimeout(refreshTimers.get(id))
  refreshTimers.set(
    id,
    setTimeout(() => {
      refreshTimers.delete(id)
      void refreshProviderModels(id)
    }, delay)
  )
}

/** 进入页面时：预置提供商已填 Key 就刷新一次模型列表，拿到服务端最新的模型 */
export const initPresetProviderModels = () => {
  const preset = useProviders.getState().providers.find((item) => isPresetProvider(item.id))
  if (preset?.apiKey.trim()) {
    void refreshProviderModels(preset.id)
  }
}

/** 只返回启用的提供商，模型选择器与请求路由都用它 */
export const enabledProviders = (providers: CustomProvider[]) =>
  providers.filter((provider) => provider.enabled)

/** 从模型列表文本（逗号 / 换行 / 空格分隔）解析模型 id */
export const parseModelIds = (text: string): string[] =>
  [...new Set(text.split(/[\s,，;；]+/).map((item) => item.trim()).filter(Boolean))]

/** 一张全空的提供商卡片（什么都没填）在设置关闭时自动丢弃 */
export const isBlankProvider = (provider: CustomProvider) =>
  !provider.name.trim() && !provider.baseUrl.trim() && !provider.apiKey.trim() && provider.models.length === 0

export const pruneBlankProviders = () => {
  const providers = useProviders.getState().providers
  const kept = providers.filter((provider) => !isBlankProvider(provider))
  if (kept.length !== providers.length) {
    commit(kept)
  }
}
