import { useTranslate } from '../../i18n/index.js'
import clsx from 'clsx'
import {
  addProvider,
  isPresetProvider,
  parseModelIds,
  refreshProviderModels,
  removeProvider,
  scheduleProviderModelsRefresh,
  updateProvider,
  useProviders,
  type ProviderProtocol,
} from '../../services/providers.js'
import { IconButton } from '../base/IconButton.js'
import { Checkbox } from '../base/Checkbox.js'
import { Select } from '../base/Select.js'
import { IconRefreshOutline16, IconTrashOutline16 } from '../base/icons.js'
import styles from './Settings.module.css'

/** 预置提供商：地址与协议固定，只填 API Key，模型列表自动获取 */
const PresetProviderCard = ({ id }: { id: string }) => {
  const t = useTranslate()
  const provider = useProviders((state) => state.providers.find((item) => item.id === id))
  const fetch = useProviders((state) => state.modelFetch[id])
  if (!provider) {
    return null
  }
  const hasKey = Boolean(provider.apiKey.trim())
  const status =
    fetch?.status === 'loading'
      ? t('providerModelsLoading')
      : fetch?.status === 'error'
        ? t('providerModelsFetchError', { message: fetch.error ?? '' })
        : !hasKey
          ? t('providerPresetHint')
          : provider.models.length > 0
            ? t('providerModelsCount', { count: provider.models.length })
            : t('providerModelsNone')
  return (
    <div className={styles.providerCard}>
      <div className={styles.providerHead}>
        <div className={clsx(styles.providerInput, styles.providerName, styles.providerStatic)}>
          {provider.name}
        </div>
        <Checkbox
          checked={provider.enabled}
          ariaLabel={t('providerEnabled')}
          onChange={(enabled) => updateProvider(id, { enabled })}
        />
        <IconButton
          icon={<IconRefreshOutline16 />}
          tooltip={t('providerModelsRefresh')}
          disabled={!hasKey || fetch?.status === 'loading'}
          onClick={() => void refreshProviderModels(id)}
        />
      </div>
      <div className={styles.description}>{provider.baseUrl}</div>
      <input
        className={styles.providerInput}
        type="password"
        value={provider.apiKey}
        placeholder="API Key"
        autoComplete="off"
        onChange={(event) => {
          updateProvider(id, { apiKey: event.target.value })
          scheduleProviderModelsRefresh(id)
        }}
      />
      <div className={clsx(styles.description, fetch?.status === 'error' && styles.error)}>{status}</div>
    </div>
  )
}

/** 单张提供商卡片：名称 / 地址 / 协议 / Key / 模型 / 启用开关 */
const ProviderCard = ({ id }: { id: string }) => {
  const t = useTranslate()
  const provider = useProviders((state) => state.providers.find((item) => item.id === id))
  if (!provider) {
    return null
  }
  return (
    <div className={styles.providerCard}>
      <div className={styles.providerHead}>
        <input
          className={clsx(styles.providerInput, styles.providerName)}
          value={provider.name}
          placeholder={t('providerNamePlaceholder')}
          onChange={(event) => updateProvider(id, { name: event.target.value })}
        />
        {/* 只有启用的提供商会出现在模型选择器里；开关用统一的圆形复选框，紧挨删除按钮 */}
        <Checkbox
          checked={provider.enabled}
          ariaLabel={t('providerEnabled')}
          onChange={(enabled) => updateProvider(id, { enabled })}
        />
        <IconButton
          icon={<IconTrashOutline16 />}
          tooltip={t('providerRemove')}
          onClick={() => removeProvider(id)}
        />
      </div>
      <input
        className={styles.providerInput}
        value={provider.baseUrl}
        placeholder={t('providerBaseUrlPlaceholder')}
        onChange={(event) => updateProvider(id, { baseUrl: event.target.value })}
      />
      {/* 协议决定请求走 Anthropic 的 /messages 还是 OpenAI 的 /chat/completions */}
      <Select<ProviderProtocol>
        value={provider.protocol}
        options={[
          { value: 'anthropic', label: t('providerProtocolAnthropic') },
          { value: 'openai', label: t('providerProtocolOpenAI') },
          { value: 'responses', label: t('providerProtocolResponses') },
        ]}
        onChange={(protocol) => updateProvider(id, { protocol })}
        ariaLabel={t('providerProtocol')}
        className={styles.providerSelect}
      />
      <input
        className={styles.providerInput}
        type="password"
        value={provider.apiKey}
        placeholder="API Key"
        autoComplete="off"
        onChange={(event) => updateProvider(id, { apiKey: event.target.value })}
      />
      <input
        className={styles.providerInput}
        value={provider.models.join(', ')}
        placeholder={t('providerModelsPlaceholder')}
        onChange={(event) => updateProvider(id, { models: parseModelIds(event.target.value) })}
      />
    </div>
  )
}

/** 账号管理页里的「模型提供商」区块 */
export const ProviderSettings = () => {
  const t = useTranslate()
  const providers = useProviders((state) => state.providers)
  return (
    <div className={styles.providerList}>
      {providers.map((provider) =>
        isPresetProvider(provider.id) ? (
          <PresetProviderCard key={provider.id} id={provider.id} />
        ) : (
          <ProviderCard key={provider.id} id={provider.id} />
        )
      )}
      <button type="button" className={styles.providerAdd} onClick={() => addProvider()}>
        {t('providerAdd')}
      </button>
    </div>
  )
}
