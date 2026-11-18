import { translate, type TranslationMessage } from '../../i18n/index.js'
import { readMessageEvent } from './parseEvent.js'
import { readServerSentEvents } from './sse.js'
import type {
  ApiErrorBody,
  CreateMessageRequest,
  FileObject,
  FilePurpose,
  MessageStreamEvent,
  MessageUsage,
  StopReason,
} from './types.js'

/** 构建期 API 地址，默认 https://api.deepseek.com；本地开发支持开发服务器代理 */
export const API_ORIGIN = __API_ORIGIN__
/** Anthropic 兼容接口的前缀 */
const ANTHROPIC_BASE_URL = `${API_ORIGIN}/anthropic/v1`
/** 引用 Files API 上传的图片、调用 Anthropic 兼容 Files API 时必须携带 */
const FILES_BETA = 'files-api-2025-04-14'

export type ApiErrorKind =
  /** 非 2xx 响应 */
  | 'http'
  /** 流中返回的错误帧（如等待生成超时），随后连接关闭 */
  | 'stream'
  /** 请求没有到达服务端（断网、跨域被拦截等） */
  | 'network'
  /** 流在 message_stop 之前结束 */
  | 'interrupted'
  /** 响应不符合协议（如非 SSE 响应） */
  | 'protocol'

export class ApiError extends Error {
  readonly localMessage?: TranslationMessage

  constructor(
    readonly kind: ApiErrorKind,
    message: string | TranslationMessage,
    readonly status?: number
  ) {
    super(typeof message === 'string' ? message : translate(message.key, message.params))
    this.name = 'ApiError'
    this.localMessage = typeof message === 'string' ? undefined : message
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isErrorBody = (value: unknown): value is ApiErrorBody =>
  typeof value === 'object' &&
  value !== null &&
  'error' in value &&
  typeof (value as ApiErrorBody).error?.message === 'string'

const readErrorResponse = async (
  response: Response,
  kind: 'http' | 'protocol' = 'http',
  fallback = response.statusText
): Promise<ApiError> => {
  const text = await response.text().catch(() => '')
  let message = text || fallback
  try {
    const body: unknown = JSON.parse(text)
    if (isErrorBody(body)) {
      message = body.error.message
    }
  } catch {
    // 非 JSON 响应体直接展示原文
  }
  return new ApiError(kind, message, response.status)
}

export const request = async (url: string, init: RequestInit): Promise<Response> => {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (init.signal?.aborted) {
      throw error
    }
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }
  if (!response.ok) {
    throw await readErrorResponse(response)
  }
  return response
}

const anthropicHeaders = (apiKey: string, beta: boolean): Record<string, string> => ({
  // DeepSeek 兼容接口的鉴权方式，也可使用 Authorization: Bearer。
  'x-api-key': apiKey,
  // Files API 和通过 file_id 引用图片时必传；纯文本聊天无需携带。
  ...(beta ? { 'anthropic-beta': FILES_BETA } : {}),
})

/** 用 GET /models 校验 API Key（不产生费用） */
export const verifyApiKey = async (apiKey: string, signal?: AbortSignal): Promise<void> => {
  await request(`${API_ORIGIN}/models`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  })
}

/**
 * POST /anthropic/v1/files 上传附件（不设过期时间，会话里的历史附件一直可用）。
 * purpose 为 null 时不传该字段（图片）；purpose 必须排在 file 之前。
 */
export const uploadFile = async (
  apiKey: string,
  file: File,
  purpose: FilePurpose | null,
  signal?: AbortSignal
): Promise<FileObject> => {
  const form = new FormData()
  if (purpose) {
    form.append('purpose', purpose)
  }
  form.append('file', file)
  const response = await request(`${ANTHROPIC_BASE_URL}/files`, {
    method: 'POST',
    headers: anthropicHeaders(apiKey, true),
    body: form,
    signal,
  })
  return (await response.json()) as FileObject
}

/** DELETE /anthropic/v1/files/{file_id} */
export const deleteFile = async (apiKey: string, fileId: string): Promise<void> => {
  await request(`${ANTHROPIC_BASE_URL}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: anthropicHeaders(apiKey, true),
  })
}

const hasFile = (body: CreateMessageRequest) =>
  body.messages.some(
    (message) =>
      typeof message.content !== 'string' &&
      message.content.some((block) => block.type === 'image' || block.type === 'document')
  )

/**
 * POST /anthropic/v1/messages（stream: true），逐个产出流式事件，收到 message_stop 时结束。
 * ping、保活注释与无法解析的内容不产出；中止请求时抛出 signal 的 AbortError。
 * `baseUrl` 用于把请求发到用户配置的其他兼容提供商，缺省走内置 DeepSeek。
 */
export async function* streamMessage(
  apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal,
  baseUrl = ANTHROPIC_BASE_URL
): AsyncGenerator<MessageStreamEvent> {
  const response = await request(`${baseUrl.replace(/\/+$/, '')}/messages`, {
    method: 'POST',
    headers: {
      ...anthropicHeaders(apiKey, hasFile(body)),
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }
  for await (const { event: eventName, data } of readServerSentEvents(response.body, signal)) {
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      if (eventName !== 'error') {
        continue
      }
    }
    if (isErrorBody(payload)) {
      throw new ApiError('stream', payload.error.message)
    }
    if (eventName === 'error') {
      throw new ApiError('stream', data)
    }
    const event = readMessageEvent(payload)
    if (!event) {
      continue
    }
    yield event
    if (event.type === 'message_stop') {
      return
    }
  }
  // 服务端没有提供错误内容时保持为空，不推测断流原因。
  throw new ApiError('interrupted', '')
}

// ---------- OpenAI 兼容（POST /chat/completions） ----------

/** GET {baseUrl}/models（OpenAI 兼容），返回去重后的模型 id 列表 */
export const listModels = async (
  apiKey: string,
  baseUrl: string,
  signal?: AbortSignal
): Promise<string[]> => {
  const response = await request(`${baseUrl.replace(/\/+$/, '')}/models`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  })
  const body: unknown = await response.json().catch(() => null)
  const list = isRecord(body) && Array.isArray(body.data) ? body.data : []
  const ids = list
    .map((item) => (isRecord(item) && typeof item.id === 'string' ? item.id.trim() : ''))
    .filter(Boolean)
  if (ids.length === 0) {
    throw new ApiError('protocol', { key: 'providerModelsEmpty' })
  }
  return [...new Set(ids)]
}

/** OpenAI 兼容端点的消息体：只有纯文本，扩展字段一律不带 */
type ChatMessageParam = { role: 'system' | 'user' | 'assistant'; content: string }

/** 只取文本块拼接；图片与文档块依赖 Files API，OpenAI 兼容端点无法引用，直接跳过 */
const joinTextBlocks = (blocks: { type: string; text?: string }[]): string =>
  blocks
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .filter(Boolean)
    .join('\n\n')

/**
 * 把本应用的请求体转换成 OpenAI 兼容格式：
 * 服务端工具（deepseek_*）、思考预算、标题生成与内容安全校验都是扩展字段，兼容端点不认识，统一丢弃。
 */
const toChatMessages = (body: CreateMessageRequest): ChatMessageParam[] => {
  const messages: ChatMessageParam[] = [{ role: 'system', content: body.system }]
  for (const message of body.messages) {
    // latest_reminder 是 Chat Engine 扩展角色，兼容端点不认识
    if (message.role === 'latest_reminder') {
      continue
    }
    if (message.role === 'user') {
      messages.push({
        role: 'user',
        content: typeof message.content === 'string' ? message.content : joinTextBlocks(message.content),
      })
      continue
    }
    // 历史助手消息只回传正文：思考块与工具块不属于 OpenAI 协议
    const content = joinTextBlocks(message.content)
    if (content) {
      messages.push({ role: 'assistant', content })
    }
  }
  return messages
}

/** 流式分片：正文在 choices[0].delta.content，思考在 delta.reasoning_content，用量在 usage */
const readChatChunk = (value: unknown) => {
  if (!isRecord(value)) {
    return null
  }
  const choice = Array.isArray(value.choices) ? value.choices[0] : undefined
  const delta = isRecord(choice) && isRecord(choice.delta) ? choice.delta : undefined
  return {
    reasoning: typeof delta?.reasoning_content === 'string' ? delta.reasoning_content : '',
    text: typeof delta?.content === 'string' ? delta.content : '',
    finish: isRecord(choice) && typeof choice.finish_reason === 'string' ? choice.finish_reason : '',
    usage: isRecord(value.usage) ? value.usage : undefined,
  }
}

const CHAT_STOP_REASONS: Record<string, StopReason> = {
  stop: 'end_turn',
  length: 'max_tokens',
  tool_calls: 'tool_use',
  function_call: 'tool_use',
  content_filter: 'refusal',
}

const toMessageUsage = (raw: Record<string, unknown>): MessageUsage => ({
  input_tokens: typeof raw.prompt_tokens === 'number' ? raw.prompt_tokens : 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  output_tokens: typeof raw.completion_tokens === 'number' ? raw.completion_tokens : 0,
})

/** 200 + JSON（非 SSE）时，部分中转站把拒绝话术放在 choices[0].message.content，优先展示这段文字 */
const readChatPlainContent = (text: string): string | null => {
  try {
    const body: unknown = JSON.parse(text)
    const choice = isRecord(body) && Array.isArray(body.choices) ? body.choices[0] : undefined
    const content = isRecord(choice) && isRecord(choice.message) ? choice.message.content : undefined
    return typeof content === 'string' && content.trim() ? content : null
  } catch {
    return null
  }
}

/**
 * POST /chat/completions（stream: true），把 OpenAI 兼容分片归一化成本应用的事件序列：
 * 思考块（reasoning_content）在前、正文块在后，最后以 message_delta + message_stop 收尾。
 * 只用于协议设为 openai 的提供商；附件、服务端工具与标题生成在该协议下不可用。
 */
export async function* streamChatCompletion(
  apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal,
  baseUrl: string
): AsyncGenerator<MessageStreamEvent> {
  // 附件靠 Files API 的 file_id 引用，OpenAI 兼容端点无从取用：明确报错，不静默丢附件
  if (hasFile(body)) {
    throw new ApiError('protocol', { key: 'providerNoAttachments' })
  }
  let response: Response
  try {
    response = await request(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ model: body.model, messages: toChatMessages(body), stream: true }),
      signal,
    })
  } catch (error) {
    // 中转站的 5xx 会带具体原因（如上游账号选择超时）：去掉状态码，让会话直接展示服务端原文，
    // 而不是笼统的「服务器繁忙」；没有原文时保持原错误
    if (error instanceof ApiError && error.kind === 'http' && (error.status ?? 0) >= 500 && error.message) {
      throw new ApiError('http', error.message)
    }
    throw error
  }
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    const text = await response.text().catch(() => '')
    throw new ApiError('protocol', readChatPlainContent(text) ?? text)
  }

  let nextIndex = 0
  let open: 'thinking' | 'text' | null = null
  let thinkingIndex = -1
  let textIndex = -1
  let stopReason: StopReason = 'end_turn'
  let usage: MessageUsage | undefined

  yield {
    type: 'message_start',
    message: { id: `chatcmpl_${Date.now().toString(36)}`, model: body.model },
  }

  for await (const { data } of readServerSentEvents(response.body, signal)) {
    if (data === '[DONE]') {
      break
    }
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      continue
    }
    if (isErrorBody(payload)) {
      throw new ApiError('stream', payload.error.message)
    }
    const chunk = readChatChunk(payload)
    if (!chunk) {
      continue
    }
    if (chunk.usage) {
      usage = toMessageUsage(chunk.usage)
    }
    if (chunk.reasoning) {
      if (open !== 'thinking') {
        if (open === 'text') {
          yield { type: 'content_block_stop', index: textIndex }
        }
        thinkingIndex = nextIndex++
        open = 'thinking'
        yield {
          type: 'content_block_start',
          index: thinkingIndex,
          content_block: { type: 'thinking', thinking: '', signature: '' },
        }
      }
      yield {
        type: 'content_block_delta',
        index: thinkingIndex,
        delta: { type: 'thinking_delta', thinking: chunk.reasoning },
      }
    }
    if (chunk.text) {
      if (open !== 'text') {
        if (open === 'thinking') {
          yield { type: 'content_block_stop', index: thinkingIndex }
        }
        textIndex = nextIndex++
        open = 'text'
        yield {
          type: 'content_block_start',
          index: textIndex,
          content_block: { type: 'text', text: '' },
        }
      }
      yield {
        type: 'content_block_delta',
        index: textIndex,
        delta: { type: 'text_delta', text: chunk.text },
      }
    }
    if (chunk.finish) {
      stopReason = CHAT_STOP_REASONS[chunk.finish] ?? 'end_turn'
    }
  }

  if (open === 'thinking') {
    yield { type: 'content_block_stop', index: thinkingIndex }
  } else if (open === 'text') {
    yield { type: 'content_block_stop', index: textIndex }
  }
  yield { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage }
  yield { type: 'message_stop' }
}
