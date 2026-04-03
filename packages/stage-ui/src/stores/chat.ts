import type { WebSocketEventInputs } from '@proj-airi/server-sdk'
import type { ChatProvider } from '@xsai-ext/providers/utils'
import type { CommonContentPart, Message, ToolMessage } from '@xsai/shared-chat'

import type { ChatAssistantMessage, ChatHistoryItem, ChatSlices, ChatStreamEventContext, StreamingAssistantMessage } from '../types/chat'
import type { StreamEvent, StreamOptions } from './llm'

import { createQueue } from '@proj-airi/stream-kit'
import { nanoid } from 'nanoid'
import { defineStore, storeToRefs } from 'pinia'
import { ref, toRaw } from 'vue'

import { useAnalytics } from '../composables'
import { useLlmmarkerParser } from '../composables/llm-marker-parser'
import { categorizeResponse, createStreamingCategorizer } from '../composables/response-categoriser'
import { shouldAttemptBridge, shouldUseStandardLlmStream } from './chat-bridge-mode'
import { createDatetimeContext } from './chat/context-providers'
import { useChatContextStore } from './chat/context-store'
import { createChatHooks } from './chat/hooks'
import { useChatSessionStore } from './chat/session-store'
import { useChatStreamStore } from './chat/stream-store'
import { useLLM } from './llm'
import { useConsciousnessStore } from './modules/consciousness'

interface LobsterBridgeOptions {
  fileAttachments?: Array<{ type: 'file', data: string, mimeType: string, name: string }>
  skillIds?: string[]
  baseUrl: string
  apiKey: string
  useBridge?: boolean
}

interface SendOptions {
  model: string
  chatProvider: ChatProvider
  providerConfig?: Record<string, unknown>
  attachments?: { type: 'image', data: string, mimeType: string }[]
  tools?: StreamOptions['tools']
  input?: WebSocketEventInputs
  bridgeOptions?: LobsterBridgeOptions
}

interface ForkOptions {
  fromSessionId?: string
  atIndex?: number
  reason?: string
  hidden?: boolean
}

interface QueuedSend {
  sendingMessage: string
  options: SendOptions
  generation: number
  sessionId: string
  cancelled?: boolean
  deferred: {
    resolve: () => void
    reject: (error: unknown) => void
  }
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string')
    return content

  if (!Array.isArray(content))
    return ''

  return content
    .map((part) => {
      if (typeof part === 'string')
        return part
      if (part && typeof part === 'object' && 'text' in part)
        return String(part.text ?? '')
      return ''
    })
    .join('')
    .trim()
}

function extractBridgeSystemPrompt(messages: Array<{ role: string, content: unknown }>): string | undefined {
  const systemMessage = messages.find(message => message.role === 'system')
  const systemPrompt = extractTextContent(systemMessage?.content)
  return systemPrompt || undefined
}

export const useChatOrchestratorStore = defineStore('chat-orchestrator', () => {
  const llmStore = useLLM()
  const consciousnessStore = useConsciousnessStore()
  const { activeProvider } = storeToRefs(consciousnessStore)
  const { trackFirstMessage } = useAnalytics()

  const chatSession = useChatSessionStore()
  const chatStream = useChatStreamStore()
  const chatContext = useChatContextStore()
  const { activeSessionId } = storeToRefs(chatSession)
  const { streamingMessage } = storeToRefs(chatStream)

  const sending = ref(false)
  const pendingQueuedSends = ref<QueuedSend[]>([])
  const hooks = createChatHooks()

  const sendQueue = createQueue<QueuedSend>({
    handlers: [
      async ({ data }) => {
        const { sendingMessage, options, generation, deferred, sessionId, cancelled } = data

        if (cancelled)
          return

        if (chatSession.getSessionGeneration(sessionId) !== generation) {
          deferred.reject(new Error('Chat session was reset before send could start'))
          return
        }

        try {
          await performSend(sendingMessage, options, generation, sessionId)
          deferred.resolve()
        }
        catch (error) {
          deferred.reject(error)
        }
      },
    ],
  })

  sendQueue.on('enqueue', (queuedSend) => {
    pendingQueuedSends.value = [...pendingQueuedSends.value, queuedSend]
  })

  sendQueue.on('dequeue', (queuedSend) => {
    pendingQueuedSends.value = pendingQueuedSends.value.filter(item => item !== queuedSend)
  })

  async function performSend(
    sendingMessage: string,
    options: SendOptions,
    generation: number,
    sessionId: string,
  ) {
    if (!sendingMessage && !options.attachments?.length)
      return

    chatSession.ensureSession(sessionId)

    // Inject current datetime context before composing the message
    chatContext.ingestContextMessage(createDatetimeContext())

    const sendingCreatedAt = Date.now()
    const streamingMessageContext: ChatStreamEventContext = {
      message: { role: 'user', content: sendingMessage, createdAt: sendingCreatedAt, id: nanoid() },
      contexts: chatContext.getContextsSnapshot(),
      composedMessage: [],
      input: options.input,
    }

    const isStaleGeneration = () => chatSession.getSessionGeneration(sessionId) !== generation
    const shouldAbort = () => isStaleGeneration()
    if (shouldAbort())
      return

    sending.value = true

    const isForegroundSession = () => sessionId === activeSessionId.value

    const buildingMessage: StreamingAssistantMessage = { role: 'assistant', content: '', slices: [], tool_results: [], createdAt: Date.now(), id: nanoid() }

    const updateUI = () => {
      if (isForegroundSession()) {
        streamingMessage.value = JSON.parse(JSON.stringify(buildingMessage))
      }
    }

    updateUI()
    trackFirstMessage()

    let sessionMessagesForSend: ChatHistoryItem[] = []

    try {
      await hooks.emitBeforeMessageComposedHooks(sendingMessage, streamingMessageContext)

      const contentParts: CommonContentPart[] = [{ type: 'text', text: sendingMessage }]

      if (options.attachments) {
        for (const attachment of options.attachments) {
          if (attachment.type === 'image') {
            contentParts.push({
              type: 'image_url',
              image_url: {
                url: `data:${attachment.mimeType};base64,${attachment.data}`,
              },
            })
          }
        }
      }

      const finalContent = contentParts.length > 1 ? contentParts : sendingMessage
      if (!streamingMessageContext.input) {
        streamingMessageContext.input = {
          type: 'input:text',
          data: {
            text: sendingMessage,
          },
        }
      }

      if (shouldAbort())
        return

      sessionMessagesForSend = chatSession.getSessionMessages(sessionId)
      sessionMessagesForSend.push({ role: 'user', content: finalContent, createdAt: sendingCreatedAt, id: nanoid() })
      chatSession.persistSessionMessages(sessionId)

      const categorizer = createStreamingCategorizer(activeProvider.value)
      let streamPosition = 0

      const parser = useLlmmarkerParser({
        onLiteral: async (literal) => {
          if (shouldAbort())
            return

          categorizer.consume(literal)

          const speechOnly = categorizer.filterToSpeech(literal, streamPosition)
          streamPosition += literal.length

          if (speechOnly.trim()) {
            buildingMessage.content += speechOnly

            await hooks.emitTokenLiteralHooks(speechOnly, streamingMessageContext)

            const lastSlice = buildingMessage.slices.at(-1)
            if (lastSlice?.type === 'text') {
              lastSlice.text += speechOnly
            }
            else {
              buildingMessage.slices.push({
                type: 'text',
                text: speechOnly,
              })
            }
            updateUI()
          }
        },
        onSpecial: async (special) => {
          if (shouldAbort())
            return

          await hooks.emitTokenSpecialHooks(special, streamingMessageContext)
        },
        onEnd: async (fullText) => {
          if (isStaleGeneration())
            return

          const finalCategorization = categorizeResponse(fullText, activeProvider.value)

          buildingMessage.categorization = {
            speech: finalCategorization.speech,
            reasoning: finalCategorization.reasoning,
          }
          updateUI()
        },
        minLiteralEmitLength: 4,
      })

      const toolCallQueue = createQueue<ChatSlices>({
        handlers: [
          async (ctx) => {
            if (shouldAbort())
              return
            if (ctx.data.type === 'tool-call') {
              buildingMessage.slices.push(ctx.data)
              updateUI()
              return
            }

            if (ctx.data.type === 'tool-call-result') {
              buildingMessage.tool_results.push(ctx.data)
              updateUI()
            }
          },
        ],
      })

      let newMessages = sessionMessagesForSend.map((msg) => {
        const { context: _context, id: _id, createdAt: _createdAt, ...withoutContext } = msg
        const rawMessage = toRaw(withoutContext)

        if (rawMessage.role === 'assistant') {
          const { slices: _slices, tool_results: _toolResults, categorization: _categorization, ...rest } = rawMessage as ChatAssistantMessage
          return toRaw(rest)
        }

        return rawMessage
      })

      const contextsSnapshot = chatContext.getContextsSnapshot()
      if (Object.keys(contextsSnapshot).length > 0) {
        const system = newMessages.slice(0, 1)
        const afterSystem = newMessages.slice(1, newMessages.length)

        newMessages = [
          ...system,
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: ''
                  + 'These are the contextual information retrieved or on-demand updated from other modules, you may use them as context for chat, or reference of the next action, tool call, etc.:\n'
                  + `${Object.entries(contextsSnapshot).map(([key, value]) => `Module ${key}: ${JSON.stringify(value)}`).join('\n')}\n`,
              },
            ],
          },
          ...afterSystem,
        ]
      }

      streamingMessageContext.composedMessage = newMessages as Message[]

      await hooks.emitAfterMessageComposedHooks(sendingMessage, streamingMessageContext)
      await hooks.emitBeforeSendHooks(sendingMessage, streamingMessageContext)

      let fullText = ''
      const headers = (options.providerConfig?.headers || {}) as Record<string, string>
      const streamTimeoutMs = 25000
      let streamTimeoutId: ReturnType<typeof setTimeout> | undefined
      let timeoutReject: ((err: Error) => void) | null = null
      const timeoutPromise = new Promise<void>((_, reject) => {
        timeoutReject = reject
      })
      const scheduleStreamTimeout = () => {
        if (streamTimeoutId) {
          clearTimeout(streamTimeoutId)
        }
        streamTimeoutId = setTimeout(() => {
          timeoutReject?.(new Error('Stream timeout'))
        }, streamTimeoutMs)
      }

      if (shouldAbort())
        return

      scheduleStreamTimeout()
      try {
        // NOTICE: T033-T034 -- Bridge path with fallback to standard LLM stream
        // If useBridge is false (feature flag) or Bridge fails, fall back to /v1/chat/completions
        const useBridge = shouldAttemptBridge(options.bridgeOptions)
        let bridgeFailed = false

        if (options.bridgeOptions && useBridge) {
          try {
            // Bridge path: use Lobster Bridge AsyncIterable stream
            const { streamChat } = await import('../services/lobster-bridge')
            const { baseUrl, apiKey, fileAttachments, skillIds } = options.bridgeOptions

            // Upload file attachments if any
            let uploadedFileIds: string[] = []
            if (fileAttachments?.length) {
              const { uploadFiles, bindSession } = await import('../services/lobster-bridge')
              await bindSession(baseUrl, apiKey, sessionId)
              uploadedFileIds = await uploadFiles(baseUrl, apiKey, sessionId, fileAttachments)
            }

            const bridgePayload = {
              airiSessionId: sessionId,
              model: options.model,
              stream: true as const,
              fileIds: uploadedFileIds,
              skillIds,
              systemPrompt: extractBridgeSystemPrompt(newMessages as Array<{ role: string, content: unknown }>),
              messages: [{ role: 'user' as const, content: sendingMessage }],
            } as any

            for await (const event of streamChat({
              baseUrl,
              apiKey,
              request: bridgePayload,
              onStateChange: async (state: string) => {
                await hooks.emitBridgeStateChangedHooks(state, streamingMessageContext)
              },
              onPermissionRequest: async (permPayload) => {
                await hooks.emitBridgePermissionRequestHooks({
                  requestId: permPayload.requestId,
                  capabilityToken: permPayload.capabilityToken,
                  toolName: permPayload.toolName,
                  toolInput: permPayload.toolInput,
                  expiresAt: permPayload.expiresAt,
                }, streamingMessageContext)
              },
            })) {
              if (shouldAbort())
                break

              scheduleStreamTimeout()
              const eventType = (event as any).type

              switch (eventType) {
                case 'assistant.delta': {
                  const delta = (event as any).payload?.delta ?? ''
                  if (!delta)
                    break
                  fullText += delta
                  await parser.consume(delta)
                  break
                }
                case 'assistant.final': {
                  const finalContent = (event as any).payload?.content ?? ''
                  if (finalContent) {
                    if (!fullText) {
                      fullText = finalContent
                      await parser.consume(finalContent)
                    }
                    else if (finalContent.startsWith(fullText)) {
                      const suffix = finalContent.slice(fullText.length)
                      fullText = finalContent
                      if (suffix)
                        await parser.consume(suffix)
                    }
                    else if (finalContent !== fullText) {
                      fullText = finalContent
                    }
                  }
                  break
                }
                case 'reasoning.delta': {
                  const delta = (event as any).payload?.delta ?? ''
                  if (delta) {
                    buildingMessage.categorization = buildingMessage.categorization ?? { speech: '', reasoning: '' }
                    buildingMessage.categorization.reasoning += delta
                    updateUI()
                  }
                  break
                }
                case 'reasoning.final': {
                  const finalReasoning = (event as any).payload?.content ?? ''
                  buildingMessage.categorization = buildingMessage.categorization ?? { speech: '', reasoning: '' }
                  buildingMessage.categorization.reasoning = finalReasoning
                  updateUI()
                  break
                }
                case 'tool.call': {
                  const toolCallEvent = event as any
                  toolCallQueue.enqueue({
                    type: 'tool-call',
                    toolCall: {
                      toolName: String(toolCallEvent.payload?.name ?? ''),
                      args: typeof toolCallEvent.payload?.input === 'string'
                        ? toolCallEvent.payload.input
                        : JSON.stringify(toolCallEvent.payload?.input ?? {}, null, 2),
                      toolCallId: String(toolCallEvent.payload?.id ?? nanoid()),
                      toolCallType: 'function',
                    },
                  })
                  break
                }
                case 'tool.result': {
                  const toolResultEvent = event as any
                  const toolCallId = String(toolResultEvent.payload?.id ?? nanoid())
                  const result = typeof toolResultEvent.payload?.result === 'string'
                    ? toolResultEvent.payload.result
                    : JSON.stringify(toolResultEvent.payload?.result ?? {}, null, 2)
                  toolCallQueue.enqueue({
                    type: 'tool-call-result',
                    id: toolCallId,
                    result,
                  })
                  break
                }
                case 'done':
                case 'session.bound':
                case 'state.changed':
                  break
              }
            }
          }
          catch (bridgeError) {
            // T034: Bridge fallback -- log and fall through to standard LLM stream
            console.warn('[chat] Bridge stream failed, falling back to standard LLM stream:', bridgeError)
            bridgeFailed = true
          }
        }

        // Standard path: use llmStore.stream (always if no bridgeOptions, or if Bridge failed/disabled)
        if (shouldUseStandardLlmStream(options.bridgeOptions, bridgeFailed)) {
          await Promise.race([
            llmStore.stream(options.model, options.chatProvider, newMessages as Message[], {
              headers,
              tools: options.tools,
              onStreamEvent: async (event: StreamEvent) => {
                scheduleStreamTimeout()
                switch (event.type) {
                  case 'tool-call':
                    toolCallQueue.enqueue({
                      type: 'tool-call',
                      toolCall: event,
                    })

                    break
                  case 'tool-result':
                    toolCallQueue.enqueue({
                      type: 'tool-call-result',
                      id: event.toolCallId,
                      result: event.result,
                    })

                    break
                  case 'text-delta':
                    fullText += event.text
                    await parser.consume(event.text)
                    break
                  case 'finish':
                    break
                  case 'error':
                    throw event.error ?? new Error('Stream error')
                }
              },
            }),
            timeoutPromise,
          ])
        }
      }
      finally {
        if (streamTimeoutId) {
          clearTimeout(streamTimeoutId)
        }
      }

      await parser.end()

      if (
        !isStaleGeneration()
        && (
          buildingMessage.slices.length > 0
          || (typeof buildingMessage.content === 'string' && buildingMessage.content.trim().length > 0)
          || buildingMessage.tool_results.length > 0
          || Boolean(buildingMessage.categorization?.reasoning?.trim())
        )
      ) {
        sessionMessagesForSend.push(toRaw(buildingMessage))
        chatSession.persistSessionMessages(sessionId)
      }

      await hooks.emitStreamEndHooks(streamingMessageContext)
      await hooks.emitAssistantResponseEndHooks(fullText, streamingMessageContext)

      await hooks.emitAfterSendHooks(sendingMessage, streamingMessageContext)
      await hooks.emitAssistantMessageHooks({ ...buildingMessage }, fullText, streamingMessageContext)
      await hooks.emitChatTurnCompleteHooks({
        output: { ...buildingMessage },
        outputText: fullText,
        toolCalls: sessionMessagesForSend.filter(msg => msg.role === 'tool') as ToolMessage[],
      }, streamingMessageContext)

      if (isForegroundSession()) {
        streamingMessage.value = { role: 'assistant', content: '', slices: [], tool_results: [] }
      }
    }
    catch (error) {
      console.error('Error sending message:', error)
      if (!isStaleGeneration()) {
        const message = error instanceof Error ? error.message : String(error || '')
        sessionMessagesForSend.push({
          role: 'error',
          content: `请求失败，请检查模型配置或网络连接${message ? ` (${message})` : ''}`,
          createdAt: Date.now(),
          id: nanoid(),
        })
        chatSession.persistSessionMessages(sessionId)
        if (isForegroundSession()) {
          streamingMessage.value = { role: 'assistant', content: '', slices: [], tool_results: [] }
        }
      }
      throw error
    }
    finally {
      sending.value = false
    }
  }

  async function ingest(
    sendingMessage: string,
    options: SendOptions,
    targetSessionId?: string,
  ) {
    const sessionId = targetSessionId || activeSessionId.value
    const generation = chatSession.getSessionGeneration(sessionId)

    return new Promise<void>((resolve, reject) => {
      sendQueue.enqueue({
        sendingMessage,
        options,
        generation,
        sessionId,
        deferred: { resolve, reject },
      })
    })
  }

  async function ingestOnFork(
    sendingMessage: string,
    options: SendOptions,
    forkOptions?: ForkOptions,
  ) {
    const baseSessionId = forkOptions?.fromSessionId ?? activeSessionId.value
    if (!forkOptions)
      return ingest(sendingMessage, options, baseSessionId)

    const forkSessionId = await chatSession.forkSession({
      fromSessionId: baseSessionId,
      atIndex: forkOptions.atIndex,
      reason: forkOptions.reason,
      hidden: forkOptions.hidden,
    })
    return ingest(sendingMessage, options, forkSessionId || baseSessionId)
  }

  function cancelPendingSends(sessionId?: string) {
    for (const queued of pendingQueuedSends.value) {
      if (sessionId && queued.sessionId !== sessionId)
        continue

      queued.cancelled = true
      queued.deferred.reject(new Error('Chat session was reset before send could start'))
    }

    pendingQueuedSends.value = sessionId
      ? pendingQueuedSends.value.filter(item => item.sessionId !== sessionId)
      : []
  }

  return {
    sending,

    discoverToolsCompatibility: llmStore.discoverToolsCompatibility,

    ingest,
    ingestOnFork,
    cancelPendingSends,

    clearHooks: hooks.clearHooks,

    emitBeforeMessageComposedHooks: hooks.emitBeforeMessageComposedHooks,
    emitAfterMessageComposedHooks: hooks.emitAfterMessageComposedHooks,
    emitBeforeSendHooks: hooks.emitBeforeSendHooks,
    emitAfterSendHooks: hooks.emitAfterSendHooks,
    emitTokenLiteralHooks: hooks.emitTokenLiteralHooks,
    emitTokenSpecialHooks: hooks.emitTokenSpecialHooks,
    emitStreamEndHooks: hooks.emitStreamEndHooks,
    emitAssistantResponseEndHooks: hooks.emitAssistantResponseEndHooks,
    emitAssistantMessageHooks: hooks.emitAssistantMessageHooks,
    emitChatTurnCompleteHooks: hooks.emitChatTurnCompleteHooks,
    emitBridgeStateChangedHooks: hooks.emitBridgeStateChangedHooks,
    emitBridgePermissionRequestHooks: hooks.emitBridgePermissionRequestHooks,

    onBeforeMessageComposed: hooks.onBeforeMessageComposed,
    onAfterMessageComposed: hooks.onAfterMessageComposed,
    onBeforeSend: hooks.onBeforeSend,
    onAfterSend: hooks.onAfterSend,
    onTokenLiteral: hooks.onTokenLiteral,
    onTokenSpecial: hooks.onTokenSpecial,
    onStreamEnd: hooks.onStreamEnd,
    onAssistantResponseEnd: hooks.onAssistantResponseEnd,
    onAssistantMessage: hooks.onAssistantMessage,
    onChatTurnComplete: hooks.onChatTurnComplete,
    onBridgeStateChanged: hooks.onBridgeStateChanged,
    onBridgePermissionRequest: hooks.onBridgePermissionRequest,
  }
})
