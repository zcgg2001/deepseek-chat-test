import clsx from 'clsx'
import { useEffect, useRef } from 'react'
import { useTranslate } from '../i18n/index.js'
import { useSettings } from '../services/settings.js'
import { initPresetProviderModels } from '../services/providers.js'
import { useIsMobile, useMobileViewport, usePreventPageScroll } from './viewport.js'
import {
  bindChatPersistence,
  initChat,
  newChat,
  retrySaveSessions,
  selectSession,
  useChatStore,
} from '../services/chat/store.js'
import { SearchPanel } from '../components/search/SearchPanel.js'
import { closeSearchPanel } from '../components/search/searchPanelState.js'
import { SessionView } from '../components/session/SessionView.js'
import { MobileHeader } from '../components/session/MobileHeader.js'
import { Welcome } from '../components/session/Welcome.js'
import {
  ensureApiKey,
  openSettings,
  useSettingsDialog,
  type SettingsSection,
} from '../components/settings/settingsDialogState.js'
import { SettingsDialog } from '../components/settings/SettingsDialog.js'
import { ImageViewer } from '../components/markdown/ImageViewer.js'
import { Toast } from '../components/base/Toast.js'
import { showToast } from '../components/base/toastState.js'
import { onUploadNotice } from '../services/attachments.js'
import { Button } from '../components/base/Button.js'
import { stopReadAloud } from '../services/speech/readAloud.js'
import { CollapsedSider } from '../components/sider/CollapsedSider.js'
import { closeMobileSider } from '../components/sider/mobileSiderState.js'
import { MobileSider, Sider } from '../components/sider/Sider.js'
import styles from './App.module.css'

/** URL hash 路由：支持多个页面叠加，例如 #/chat/{uuid},/settings/general */
type AppRoute = {
  chatId: string | null
  settings: SettingsSection | null
}

const parseHashRoute = (hash: string): AppRoute => {
  const route: AppRoute = { chatId: null, settings: null }
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  for (const segment of raw.split(',')) {
    const value = segment.trim()
    const chatMatch = /^\/chat\/([^/?#]+)$/.exec(value)
    if (chatMatch) {
      route.chatId = decodeURIComponent(chatMatch[1])
      continue
    }
    const settingsMatch = /^\/settings\/(general|account|data|terms)$/.exec(value)
    if (settingsMatch) {
      route.settings = settingsMatch[1] as SettingsSection
    }
  }
  return route
}

export const App = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const locale = useSettings((state) => state.locale)
  // 移动端侧边栏以独立抽屉管理开合状态
  const siderCollapsed = useSettings((state) => state.siderCollapsed) && !isMobile
  const ready = useChatStore((state) => state.ready)
  const initError = useChatStore((state) => state.initError)
  const saveError = useChatStore((state) => Object.values(state.sessionSaveErrors).some(Boolean))
  const importingHistory = useChatStore((state) => state.importingHistory)
  const session = useChatStore((state) =>
    state.activeId !== null && Object.hasOwn(state.sessionCache, state.activeId)
      ? state.sessionCache[state.activeId]
      : undefined
  )
  const sessionLoadError = useChatStore((state) =>
    state.activeId === null ? false : state.sessionLoadErrors[state.activeId] === true
  )
  const frameRef = useMobileViewport(isMobile)
  const streaming = useChatStore((state) =>
    state.activeId === null ? false : Object.hasOwn(state.streaming, state.activeId)
  )
  const activeId = useChatStore((state) => state.activeId)
  const settingsOpen = useSettingsDialog((state) => state.open)
  const settingsSection = useSettingsDialog((state) => state.section)

  usePreventPageScroll(isMobile)

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  // 浏览器标题：打开会话时为「对话名称 - 应用名」，其余（含设置弹窗）为应用名
  useEffect(() => {
    const app = t('appName')
    const name = session ? session.title.trim() || t('untitledChat') : ''
    document.title = name ? t('documentTitle', { title: name, app }) : app
  }, [session, t])

  // 文件数、存储空间达到上限时，附件上只显示「上传失败」，原因用 toast 说明
  useEffect(() => onUploadNotice(showToast), [])
  useEffect(bindChatPersistence, [])

  // 搜索结果面板只属于当前会话
  useEffect(closeSearchPanel, [activeId])
  // 切换会话时停止朗读
  useEffect(stopReadAloud, [activeId])
  // 移动端选中会话、切换布局后收起抽屉
  useEffect(closeMobileSider, [activeId, isMobile])

  useEffect(() => {
    void initChat()
    // 预置提供商已填 Key 时，每次进入页面都重新获取一次服务端的最新模型列表
    initPresetProviderModels()
    // 首次打开先在设置里输入 API Key
    ensureApiKey()
  }, [])

  // 深链：#/chat/{uuid} 打开会话、#/settings/{general|data} 打开设置子页；
  // 两者可以叠加（#/chat/{uuid},/settings/general），刷新/复制链接都能还原。
  // 新对话不产生 hash。
  const hashRestoredRef = useRef(false)
  useEffect(() => {
    if (!ready || hashRestoredRef.current) {
      return
    }
    hashRestoredRef.current = true
    const route = parseHashRoute(window.location.hash)
    if (route.chatId && useChatStore.getState().sessions.some((item) => item.id === route.chatId)) {
      selectSession(route.chatId)
    }
    if (route.settings) {
      openSettings(route.settings)
    }
  }, [ready])

  // 会话 / 设置弹窗状态变化时同步 hash（按 chat → settings 顺序拼接）
  useEffect(() => {
    if (!ready || !hashRestoredRef.current) {
      return
    }
    const segments: string[] = []
    if (activeId) {
      segments.push(`/chat/${encodeURIComponent(activeId)}`)
    }
    if (settingsOpen) {
      segments.push(`/settings/${settingsSection}`)
    }
    const target = segments.length ? `#${segments.join(',')}` : ''
    if (window.location.hash !== target) {
      window.history.replaceState(null, '', target || window.location.pathname + window.location.search)
    }
  }, [activeId, ready, settingsOpen, settingsSection])

  // 浏览器前进/后退或手动改 hash 时切换页面
  useEffect(() => {
    const onHashChange = () => {
      const route = parseHashRoute(window.location.hash)
      if (route.chatId && useChatStore.getState().sessions.some((item) => item.id === route.chatId)) {
        selectSession(route.chatId)
      } else {
        newChat()
      }
      if (route.settings) {
        openSettings(route.settings)
      } else {
        useSettingsDialog.setState({ open: false })
      }
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return (
    <>
      <div ref={frameRef} className={styles.frame}>
        {isMobile ? (
          <MobileSider />
        ) : (
          <div className={clsx(styles.siderSlot, siderCollapsed && styles.siderSlotCollapsed)}>
            <Sider />
          </div>
        )}
        <main className={styles.main}>
          {saveError ? (
            <div className={styles.saveError} role="alert">
              <span>{t('sessionSaveFailed')}</span>
              <Button
                variant="outlined"
                size="s"
                disabled={importingHistory}
                onClick={retrySaveSessions}
              >
                {t('retry')}
              </Button>
            </div>
          ) : null}
          <div className={styles.content}>
            {siderCollapsed ? <CollapsedSider /> : null}
            {!ready || (activeId !== null && !session) ? (
              <div className={styles.loadingView}>
                {isMobile ? <MobileHeader /> : null}
                <div className={styles.loadingState} role="status" aria-live="polite">
                  <span>
                    {(!ready ? initError : sessionLoadError)
                      ? t(!ready ? 'sessionListLoadFailed' : 'sessionLoadFailed')
                      : t('sessionLoading')}
                  </span>
                  {(!ready ? initError : sessionLoadError) ? (
                    <Button
                      variant="outlined"
                      size="m"
                      onClick={() => {
                        if (!ready) {
                          void initChat()
                        } else if (activeId !== null) {
                          selectSession(activeId)
                        }
                      }}
                    >
                      {t('retry')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : session ? (
              <SessionView
                session={session}
                streaming={streaming}
                siderCollapsed={siderCollapsed}
              />
            ) : (
              <Welcome />
            )}
          </div>
        </main>
        <SearchPanel />
      </div>
      <SettingsDialog />
      <ImageViewer />
      <Toast />
    </>
  )
}
