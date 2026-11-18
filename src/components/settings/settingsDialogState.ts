import { create } from 'zustand'
import { useProviders } from '../../services/providers.js'
import { useSettings } from '../../services/settings.js'

/** 设置弹窗的分组：通用设置 / 账号管理 / 数据管理 / 服务协议 */
export type SettingsSection = 'general' | 'account' | 'data' | 'terms'

/** 设置弹窗：侧边栏底部、没有 API Key 时的操作与 401 提示都可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'general' as SettingsSection,
}))

export const openSettings = (section: SettingsSection) =>
  useSettingsDialog.setState({ open: true, section })

export const closeSettings = () => useSettingsDialog.setState({ open: false })

/**
 * 没有 API Key 时打开设置并选中「账号管理」，返回是否已有 Key。
 * 选中的自定义提供商自己填了 Key 时也放行，不必再填内置 DeepSeek 的 Key。
 */
export const ensureApiKey = () => {
  const { apiKey, providerId } = useSettings.getState()
  const custom = useProviders.getState().providers.find((provider) => provider.id === providerId)
  if (apiKey || (custom && custom.baseUrl.trim() && custom.apiKey.trim())) {
    return true
  }
  openSettings('account')
  return false
}
