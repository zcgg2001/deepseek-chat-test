import { create } from 'zustand'
import type { ChatModel } from './api/types.js'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 界面语言偏好：跟随系统，或固定某一种（官方「语言」下拉含「跟随系统」） */
export type LocalePreference = 'system' | Locale

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 思考强度：映射到请求里的 thinking.budget_tokens */
export type ThinkingEffort = 'standard' | 'deep' | 'max'

/** 思考强度对应的 token 预算；standard 不传，交给服务端默认值 */
export const THINKING_EFFORT_BUDGET: Record<ThinkingEffort, number | null> = {
  standard: null,
  deep: 8192,
  max: 16384,
}

/** OpenAI 兼容端点的推理等级：standard 不传，交给端点默认值；极限用最高的 xhigh */
export const THINKING_EFFORT_REASONING: Record<ThinkingEffort, string | null> = {
  standard: null,
  deep: 'high',
  max: 'xhigh',
}

/** 本机设置，存 localStorage：API Key、语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态 */
type Settings = {
  apiKey: string | null
  /** 当前生效的语言（由 localePreference 解析得到） */
  locale: Locale
  localePreference: LocalePreference
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
  /** 选中的模型，默认 deepseek-flash */
  model: ChatModel
  /** 选中的提供商 id：'deepseek' 为内置，其余对应 providers.ts 里的自定义提供商 */
  providerId: string  /** 深度思考开启时生效的思考强度 */
  thinkingEffort: ThinkingEffort
  /** 是否开启服务端内容安全校验（safety_check: high），默认关闭 */
  safetyCheck: boolean
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  locale: 'chat-demo:locale',
  localePreference: 'chat-demo:locale-preference',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
  model: 'chat-demo:model',
  providerId: 'chat-demo:provider',
  thinkingEffort: 'chat-demo:thinking-effort',
  safetyCheck: 'chat-demo:safety-check',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

/** 系统语言对应的界面语言 */
const systemLocale = (): Locale => (isChineseBrowser() ? 'zh-CN' : 'en-US')

/** 语言偏好：优先新建的 preference，兼容旧版本只存了 locale 的本地数据 */
const initialLocalePreference = (): LocalePreference => {
  const saved = read(KEYS.localePreference)
  if (saved === 'system' || saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  const legacy = read(KEYS.locale)
  if (legacy === 'zh-CN' || legacy === 'en-US') {
    return legacy
  }
  return 'system'
}

const initialLocale = (): Locale => {
  const preference = initialLocalePreference()
  return preference === 'system' ? systemLocale() : preference
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

/** 联网搜索默认开启，与官网一致；深度思考默认关闭 */
const initialSearch = (): boolean => {
  const saved = read(KEYS.search)
  return saved === null ? true : saved === 'true'
}

export const useSettings = create<Settings>(() => ({
  apiKey: read(KEYS.apiKey),
  locale: initialLocale(),
  localePreference: initialLocalePreference(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  thinking: read(KEYS.thinking) === 'true',
  search: initialSearch(),
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
  // 保留上次选中的模型 id：自定义提供商的模型 id 也要能跨刷新存活，缺失时才回落默认
  model: read(KEYS.model) || 'deepseek-flash',
  providerId: read(KEYS.providerId) || 'deepseek',
  thinkingEffort: (() => {
    const saved = read(KEYS.thinkingEffort)
    return saved === 'deep' || saved === 'max' ? saved : 'standard'
  })(),
  // 默认关闭：只有用户显式开启过才为 true
  safetyCheck: read(KEYS.safetyCheck) === 'true',
}))

export const setModel = (model: ChatModel) => {
  write(KEYS.model, model)
  useSettings.setState({ model })
}

export const setProvider = (providerId: string, model?: ChatModel) => {
  write(KEYS.providerId, providerId)
  if (model) {
    write(KEYS.model, model)
  }
  useSettings.setState(model ? { providerId, model } : { providerId })
}

export const setThinkingEffort = (thinkingEffort: ThinkingEffort) => {
  write(KEYS.thinkingEffort, thinkingEffort)
  useSettings.setState({ thinkingEffort })
}

export const setSafetyCheck = (safetyCheck: boolean) => {
  write(KEYS.safetyCheck, String(safetyCheck))
  useSettings.setState({ safetyCheck })
}

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

/** 选择「跟随系统」时立刻按系统语言生效，之后仍可在设置里改回固定语言 */
export const setLocalePreference = (localePreference: LocalePreference) => {
  write(KEYS.localePreference, localePreference)
  if (localePreference === 'system') {
    write(KEYS.locale, null)
    useSettings.setState({ localePreference, locale: systemLocale() })
    return
  }
  write(KEYS.locale, localePreference)
  useSettings.setState({ localePreference, locale: localePreference })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setApiKey = (apiKey: string | null) => {
  write(KEYS.apiKey, apiKey)
  useSettings.setState({ apiKey })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}
