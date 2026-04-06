import type { WebSocketEventInputs } from '@proj-airi/server-sdk'
import type { ChatProvider } from '@xsai-ext/providers/utils'
import type { CommonContentPart, Message, ToolMessage } from '@xsai/shared-chat'

import type { ChatAssistantMessage, ChatHistoryItem, ChatSlices, ChatStreamEventContext, StreamingAssistantMessage } from '../types/chat'
import type { ChatSessionBridgeFileRef, ChatSessionBridgeMode, ChatSessionBridgeState } from '../types/chat-session'
import type { StreamEvent, StreamOptions } from './llm'

import { defaultPerfTracer } from '@proj-airi/stage-shared'
import { createQueue } from '@proj-airi/stream-kit'
import { nanoid } from 'nanoid'
import { defineStore, storeToRefs } from 'pinia'
import { ref, toRaw } from 'vue'

import { useAnalytics } from '../composables'
import { stripLlmControlTokens, useLlmmarkerParser } from '../composables/llm-marker-parser'
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
  reattachFileRefs?: Array<{ id: string, name: string, mimeType: string, size?: number }>
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

  function getPersistedBridgeFileRefs(sessionId: string): ChatSessionBridgeFileRef[] {
    return chatSession.getSessionMeta(sessionId)?.bridgeState?.fileRefs ?? []
  }

  function getPersistedBridgeState(sessionId: string): ChatSessionBridgeState | undefined {
    return chatSession.getSessionMeta(sessionId)?.bridgeState
  }

  function updatePersistedBridgeState(sessionId: string, updater: (bridgeState: ChatSessionBridgeState | undefined) => ChatSessionBridgeState | undefined) {
    chatSession.updateBridgeState(sessionId, updater)
  }

  function setPersistedBridgeFileRefs(sessionId: string, fileRefs: ChatSessionBridgeFileRef[]) {
    updatePersistedBridgeState(sessionId, bridgeState => ({
      ...bridgeState,
      fileRefs,
    }))
  }

  function mergeBridgeFileRefs(
    existing: ChatSessionBridgeFileRef[],
    incoming: Array<{ id: string, name: string, mimeType: string, size?: number, lobsterSessionId?: string, clientTurnId?: string }>,
  ): ChatSessionBridgeFileRef[] {
    const merged = new Map(existing.map(file => [file.id, file]))
    for (const file of incoming) {
      merged.set(file.id, {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size,
        uploadedAt: Date.now(),
        bindingState: 'active',
        lobsterSessionId: file.lobsterSessionId,
        clientTurnId: file.clientTurnId,
      })
    }
    return Array.from(merged.values()).sort((a, b) => b.uploadedAt - a.uploadedAt)
  }

  function setBridgeBindingSnapshot(
    sessionId: string,
    payload: { lobsterSessionId?: string, sessionMode?: ChatSessionBridgeMode },
  ) {
    updatePersistedBridgeState(sessionId, (bridgeState) => {
      const previousSessionId = bridgeState?.lobsterSessionId
      const lobsterSessionId = payload.lobsterSessionId ?? previousSessionId
      const bindingStatus = previousSessionId && lobsterSessionId && previousSessionId !== lobsterSessionId
        ? 'rebound'
        : 'bound'
      return {
        ...bridgeState,
        lobsterSessionId,
        sessionMode: payload.sessionMode ?? bridgeState?.sessionMode,
        bindingStatus,
        lastBoundAt: Date.now(),
        fileRefs: (bridgeState?.fileRefs ?? []).map((file) => {
          if (!previousSessionId || previousSessionId === lobsterSessionId) {
            return file
          }
          return {
            ...file,
            bindingState: file.lobsterSessionId && file.lobsterSessionId !== lobsterSessionId ? 'stale' : file.bindingState,
          }
        }),
      }
    })
  }

  function markBridgeFilesState(sessionId: string, fileIds: string[], bindingState: 'active' | 'stale') {
    if (fileIds.length === 0) {
      return
    }
    const targetFileIds = new Set(fileIds)
    updatePersistedBridgeState(sessionId, bridgeState => ({
      ...bridgeState,
      fileRefs: (bridgeState?.fileRefs ?? []).map(file => targetFileIds.has(file.id)
        ? { ...file, bindingState }
        : file),
    }))
  }

  function resolveBridgeSessionMode(
    sessionId: string,
    options: Pick<LobsterBridgeOptions, 'fileAttachments' | 'reattachFileRefs' | 'skillIds'>,
    imageAttachmentCount: number,
  ): 'auto' | ChatSessionBridgeMode {
    const persistedMode = getPersistedBridgeState(sessionId)?.sessionMode
    const requiresAgent = Boolean(
      persistedMode === 'agent'
      || options.fileAttachments?.length
      || options.reattachFileRefs?.length
      || options.skillIds?.length
      || imageAttachmentCount > 0,
    )
    return requiresAgent ? 'agent' : 'auto'
  }

  function extractBridgeErrorCode(error: unknown): string | undefined {
    if (!error || typeof error !== 'object') {
      return undefined
    }
    return typeof (error as Record<string, unknown>).code === 'string'
      ? (error as Record<string, unknown>).code as string
      : undefined
  }

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
    const clientTurnId = String(streamingMessageContext.message.id)

    const perfStartedAt = performance.now()
    const useBridge = shouldAttemptBridge(options.bridgeOptions)
    let firstVisibleTokenAt: number | null = null
    let firstBridgeStateAt: number | null = null
    const perfMetaBase = {
      sessionId,
      provider: activeProvider.value,
      model: options.model,
      transport: useBridge ? 'bridge' : 'standard',
      imageAttachmentsCount: options.attachments?.length ?? 0,
      fileAttachmentsCount: options.bridgeOptions?.fileAttachments?.length ?? 0,
      skillIdsCount: options.bridgeOptions?.skillIds?.length ?? 0,
    }
    const emitChatPerfEvent = (name: string, duration?: number, meta?: Record<string, unknown>) => {
      defaultPerfTracer.emit({
        tracerId: 'chat',
        name,
        ts: perfStartedAt,
        duration,
        meta: {
          ...perfMetaBase,
          ...meta,
        },
      })
    }
    emitChatPerfEvent('turn.start')

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
            if (firstVisibleTokenAt === null) {
              firstVisibleTokenAt = performance.now()
              emitChatPerfEvent('turn.first-visible-token', firstVisibleTokenAt - perfStartedAt, {
                fullTextLength: fullText.length + speechOnly.length,
              })
            }
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
          const sanitizedSpeech = stripLlmControlTokens(finalCategorization.speech || '')
          const sanitizedFullText = stripLlmControlTokens(fullText)
          const fallbackSpeech = (sanitizedSpeech || sanitizedFullText).trim()
          const hasVisibleContent = typeof buildingMessage.content === 'string'
            ? Boolean(buildingMessage.content.trim())
            : Array.isArray(buildingMessage.content) && buildingMessage.content.length > 0

          if (!hasVisibleContent && fallbackSpeech) {
            buildingMessage.content = fallbackSpeech
          }

          if (buildingMessage.slices.length === 0 && fallbackSpeech) {
            buildingMessage.slices.push({
              type: 'text',
              text: fallbackSpeech,
            })
          }

          buildingMessage.categorization = {
            speech: sanitizedSpeech,
            reasoning: buildingMessage.categorization?.reasoning || finalCategorization.reasoning,
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
      const streamTimeoutMs = 180000
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
        if (options.bridgeOptions && useBridge) {
          const requestedReattachFileIds = options.bridgeOptions.reattachFileRefs?.map(file => file.id) ?? []
          try {
            // Bridge path: use Lobster Bridge AsyncIterable stream
            const { buildBridgePromptText, buildUserContent, extractBridgeSystemPrompt, streamChat } = await import('../services/lobster-bridge')
            const { baseUrl, apiKey, fileAttachments, reattachFileRefs, skillIds } = options.bridgeOptions
            const requestedSessionMode = resolveBridgeSessionMode(sessionId, { fileAttachments, reattachFileRefs, skillIds }, options.attachments?.length ?? 0)
            const bridgePromptText = buildBridgePromptText(sendingMessage, contextsSnapshot, {
              hasImages: Boolean(options.attachments?.length),
            })
            const bridgeUserContent = buildUserContent(bridgePromptText, options.attachments ?? [])
            const bridgeSystemPrompt = extractBridgeSystemPrompt(newMessages as Array<{ role: string, content: unknown }>)

            let resolvedBridgeFiles: Array<{ id: string, name: string, mimeType: string, size?: number }> = []
            let uploadedBridgeFiles: Array<{ id: string, name: string, mimeType: string, size?: number }> = []
            if (fileAttachments?.length) {
              const { uploadFiles, bindSession } = await import('../services/lobster-bridge')
              const binding = await bindSession(baseUrl, apiKey, sessionId)
              setBridgeBindingSnapshot(sessionId, {
                lobsterSessionId: binding.session.lobsterSessionId,
                sessionMode: binding.session.sessionMode,
              })
              uploadedBridgeFiles = await uploadFiles(baseUrl, apiKey, sessionId, clientTurnId, fileAttachments)
              resolvedBridgeFiles = [...resolvedBridgeFiles, ...uploadedBridgeFiles]
              if (uploadedBridgeFiles.length > 0) {
                setPersistedBridgeFileRefs(sessionId, mergeBridgeFileRefs(
                  getPersistedBridgeFileRefs(sessionId),
                  uploadedBridgeFiles.map(file => ({
                    ...file,
                    lobsterSessionId: binding.session.lobsterSessionId,
                    clientTurnId,
                  })),
                ))
              }
            }
            if (reattachFileRefs?.length) {
              const { bindSession, reattachFiles } = await import('../services/lobster-bridge')
              const binding = await bindSession(baseUrl, apiKey, sessionId)
              setBridgeBindingSnapshot(sessionId, {
                lobsterSessionId: binding.session.lobsterSessionId,
                sessionMode: binding.session.sessionMode,
              })
              const reattachedFiles = await reattachFiles(baseUrl, apiKey, sessionId, clientTurnId, reattachFileRefs.map(file => file.id))
              resolvedBridgeFiles = [...resolvedBridgeFiles, ...reattachedFiles]
              markBridgeFilesState(sessionId, reattachFileRefs.map(file => file.id), 'active')
            }

            const bridgePayload = {
              airiSessionId: sessionId,
              clientTurnId,
              sessionMode: requestedSessionMode,
              model: options.model,
              stream: true as const,
              fileIds: resolvedBridgeFiles.map(file => file.id),
              skillIds,
              systemPrompt: bridgeSystemPrompt,
              messages: [{ role: 'user' as const, content: bridgeUserContent }],
            } as any

            for await (const event of streamChat({
              baseUrl,
              apiKey,
              request: bridgePayload,
              onSessionBound: (payload) => {
                setBridgeBindingSnapshot(sessionId, {
                  lobsterSessionId: payload.lobsterSessionId,
                  sessionMode: payload.sessionMode,
                })
              },
              onStateChange: async (state: string) => {
                if (firstBridgeStateAt === null) {
                  firstBridgeStateAt = performance.now()
                  emitChatPerfEvent('turn.bridge-first-state', firstBridgeStateAt - perfStartedAt, {
                    state,
                  })
                }
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
                  if (!delta)
                    break
                  buildingMessage.categorization = {
                    speech: buildingMessage.categorization?.speech ?? '',
                    reasoning: `${buildingMessage.categorization?.reasoning ?? ''}${delta}`,
                  }
                  updateUI()
                  break
                }
                case 'reasoning.final': {
                  const finalReasoning = (event as any).payload?.content ?? ''
                  buildingMessage.categorization = {
                    speech: buildingMessage.categorization?.speech ?? '',
                    reasoning: finalReasoning || buildingMessage.categorization?.reasoning || '',
                  }
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
            if (extractBridgeErrorCode(bridgeError) === 'bridge_file_missing') {
              markBridgeFilesState(sessionId, requestedReattachFileIds, 'stale')
            }
            console.warn('[chat] Bridge stream failed:', bridgeError)
            throw bridgeError
          }
        }

        if (shouldUseStandardLlmStream(options.bridgeOptions)) {
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
      emitChatPerfEvent('turn.complete', performance.now() - perfStartedAt, {
        outputLength: fullText.length,
        receivedFirstVisibleToken: firstVisibleTokenAt !== null,
        firstVisibleTokenMs: firstVisibleTokenAt === null ? null : firstVisibleTokenAt - perfStartedAt,
        firstBridgeStateMs: firstBridgeStateAt === null ? null : firstBridgeStateAt - perfStartedAt,
      })

      if (isForegroundSession()) {
        streamingMessage.value = { role: 'assistant', content: '', slices: [], tool_results: [] }
      }
    }
    catch (error) {
      console.error('Error sending message:', error)
      emitChatPerfEvent('turn.error', performance.now() - perfStartedAt, {
        firstVisibleTokenMs: firstVisibleTokenAt === null ? null : firstVisibleTokenAt - perfStartedAt,
        firstBridgeStateMs: firstBridgeStateAt === null ? null : firstBridgeStateAt - perfStartedAt,
        error: error instanceof Error ? error.message : String(error || ''),
      })
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
