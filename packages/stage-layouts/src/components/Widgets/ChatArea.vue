<script setup lang="ts">
import type {
  LobsterBridgeEvent,
} from '@proj-airi/stage-ui/types/lobster-bridge'
import type { ChatProvider } from '@xsai-ext/providers/utils'

import { isStageTamagotchi } from '@proj-airi/stage-shared'
import { useAudioAnalyzer, useLobsterSkills } from '@proj-airi/stage-ui/composables'
import {
  bindSession,
  buildUserContent,
  listPendingPermissions,
  normalizeApiKey,
  normalizeBaseUrl,
  respondPermission,
  streamChat,
  uploadFiles,
} from '@proj-airi/stage-ui/services/lobster-bridge'
import { useAudioContext } from '@proj-airi/stage-ui/stores/audio'
import { useChatOrchestratorStore } from '@proj-airi/stage-ui/stores/chat'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useHearingSpeechInputPipeline, useHearingStore } from '@proj-airi/stage-ui/stores/modules/hearing'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { useSettings, useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings'
import { LobsterBridgeError } from '@proj-airi/stage-ui/types/lobster-bridge'
import { BasicTextarea } from '@proj-airi/ui'
import { until } from '@vueuse/core'
import { nanoid } from 'nanoid'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import ChatInputControls from './ChatInputControls.vue'
import LobsterPermissionList from './LobsterPermissionList.vue'
import LobsterSkillsBar from './LobsterSkillsBar.vue'

const messageInput = ref('')
const hearingTooltipOpen = ref(false)
const isComposing = ref(false)
const isListening = ref(false) // Transcription listening state (separate from microphone enabled)

interface ChatAttachment { type: 'image' | 'file', data: string, mimeType: string, name: string }
const attachments = ref<ChatAttachment[]>([])
const selectedLobsterSkillIds = ref<string[]>([])
const pendingLobsterPermissions = ref<Array<{
  requestId: string
  capabilityToken: string
  toolName: string
  toolInput: Record<string, unknown>
  turnId?: string
  createdAt?: number
  expiresAt?: number
}>>([])

function handleFileChange(event: Event) {
  const target = event.target as HTMLInputElement
  if (!target.files?.length)
    return

  for (const file of Array.from(target.files)) {
    const reader = new FileReader()
    reader.onload = (e) => {
      const result = e.target?.result as string
      const [mimePart, data] = result.split(';base64,')
      const mimeType = mimePart.split(':')[1]

      attachments.value.push({
        type: file.type.startsWith('image/') ? 'image' : 'file',
        data,
        mimeType,
        name: file.name,
      })
    }
    reader.readAsDataURL(file)
  }
  target.value = ''
}

function removeAttachment(index: number) {
  attachments.value.splice(index, 1)
}

const providersStore = useProvidersStore()
const { activeProvider, activeModel } = storeToRefs(useConsciousnessStore())
const { themeColorsHueDynamic } = storeToRefs(useSettings())

const { askPermission, startStream } = useSettingsAudioDevice()
const { enabled, selectedAudioInput, stream, audioInputs } = storeToRefs(useSettingsAudioDevice())
const chatOrchestrator = useChatOrchestratorStore()
const chatSession = useChatSessionStore()
const { ingest, onAfterMessageComposed, discoverToolsCompatibility } = chatOrchestrator
const { messages, activeSessionId } = storeToRefs(chatSession)
const { audioContext } = useAudioContext()
const { t } = useI18n()
const router = useRouter()
const { skills: lobsterSkills, totalSkillsCount, enabledSkillsCount, refreshSkills: refreshLobsterSkills } = useLobsterSkills()

function getLobsterProviderConfig() {
  return providersStore.getProviderConfig(activeProvider.value) as Record<string, any>
}

function openLobsterSkillsSettings() {
  router.push('/settings/skills')
}

function toggleMicrophoneEnabled() {
  enabled.value = !enabled.value
}

function getLobsterConnection() {
  const providerConfig = getLobsterProviderConfig()
  return {
    baseUrl: normalizeBaseUrl(providerConfig?.baseUrl),
    apiKey: normalizeApiKey(providerConfig?.apiKey),
  }
}

function normalizeAssistantContent(content: unknown) {
  if (typeof content === 'string')
    return content
  if (Array.isArray(content)) {
    return content.map((part: any) => {
      if (typeof part === 'string')
        return part
      if (part?.type === 'text' && typeof part.text === 'string')
        return part.text
      return ''
    }).join('')
  }
  return ''
}

async function loadLobsterSkills() {
  if (activeProvider.value !== 'lobster-agent')
    return
  await refreshLobsterSkills()
  syncSelectedLobsterSkillIds()
}

function syncSelectedLobsterSkillIds() {
  const availableIds = new Set(lobsterSkills.value.map(skill => skill.id))
  const retained = selectedLobsterSkillIds.value.filter(id => availableIds.has(id))
  const defaults = lobsterSkills.value.filter(skill => skill.enabled).map(skill => skill.id)
  selectedLobsterSkillIds.value = Array.from(new Set(retained.length > 0 ? retained : defaults))
}

async function ensureLobsterBridgeSession(sessionId: string) {
  const { baseUrl, apiKey } = getLobsterConnection()
  await bindSession(baseUrl, apiKey, sessionId)
}

function replacePendingLobsterPermissions(permissions: Array<{
  requestId: string
  capabilityToken: string
  toolName: string
  toolInput?: Record<string, unknown>
  turnId?: string
  createdAt?: number
  expiresAt?: number
}>) {
  pendingLobsterPermissions.value = permissions.map(permission => ({
    requestId: String(permission.requestId || ''),
    capabilityToken: String(permission.capabilityToken || ''),
    toolName: String(permission.toolName || ''),
    toolInput: permission.toolInput ?? {},
    turnId: typeof permission.turnId === 'string' ? permission.turnId : undefined,
    createdAt: typeof permission.createdAt === 'number' ? permission.createdAt : undefined,
    expiresAt: typeof permission.expiresAt === 'number' ? permission.expiresAt : undefined,
  })).filter(permission => permission.requestId && permission.capabilityToken)
}

function upsertPendingLobsterPermission(payload: {
  requestId: string
  capabilityToken: string
  toolName: string
  toolInput?: Record<string, unknown>
  turnId?: string
  createdAt?: number
  expiresAt?: number
}) {
  const next = {
    requestId: String(payload.requestId || ''),
    capabilityToken: String(payload.capabilityToken || ''),
    toolName: String(payload.toolName || ''),
    toolInput: payload.toolInput ?? {},
    turnId: typeof payload.turnId === 'string' ? payload.turnId : undefined,
    createdAt: typeof payload.createdAt === 'number' ? payload.createdAt : undefined,
    expiresAt: typeof payload.expiresAt === 'number' ? payload.expiresAt : undefined,
  }
  const index = pendingLobsterPermissions.value.findIndex(item => item.requestId === next.requestId)
  if (index === -1) {
    pendingLobsterPermissions.value = [...pendingLobsterPermissions.value, next]
    return
  }
  pendingLobsterPermissions.value = pendingLobsterPermissions.value.map((item, itemIndex) => itemIndex === index ? next : item)
}

function removePendingLobsterPermission(requestId: string) {
  pendingLobsterPermissions.value = pendingLobsterPermissions.value.filter(permission => permission.requestId !== requestId)
}

async function syncPendingLobsterPermissions() {
  if (activeProvider.value !== 'lobster-agent' || !activeSessionId.value) {
    pendingLobsterPermissions.value = []
    return
  }
  const { baseUrl, apiKey } = getLobsterConnection()
  try {
    const permissions = await listPendingPermissions(baseUrl, apiKey, activeSessionId.value)
    replacePendingLobsterPermissions(permissions)
  }
  catch {
    pendingLobsterPermissions.value = []
  }
}

async function respondToLobsterPermission(permission: {
  requestId: string
  capabilityToken: string
}, decision: 'allow' | 'deny') {
  const { baseUrl, apiKey } = getLobsterConnection()
  try {
    await respondPermission(baseUrl, apiKey, activeSessionId.value, permission.requestId, permission.capabilityToken, decision)
    removePendingLobsterPermission(permission.requestId)
  }
  catch (error) {
    await syncPendingLobsterPermissions().catch(() => {})
    throw error
  }
}

function syncAssistantMessageState(message: any, assistantContent: string, reasoningContent: string) {
  message.content = normalizeAssistantContent(assistantContent)
  const textSlice = message.slices.find((slice: any) => slice.type === 'text')
  if (textSlice) {
    textSlice.text = message.content
  }
  else if (message.content) {
    message.slices.push({ type: 'text', text: message.content })
  }
  if (reasoningContent) {
    message.categorization = {
      speech: message.content,
      reasoning: reasoningContent,
    }
  }
}

async function sendViaLobsterBridge(textToSend: string, sendingAttachments: ChatAttachment[]) {
  const { baseUrl, apiKey } = getLobsterConnection()
  const sessionId = activeSessionId.value
  const sessionMessages = chatSession.getSessionMessages(sessionId)
  const imageAttachments = sendingAttachments.filter(item => item.type === 'image')
  const fileAttachments = sendingAttachments.filter(item => item.type === 'file')

  await ensureLobsterBridgeSession(sessionId)
  const uploadedFileIds = await uploadFiles(baseUrl, apiKey, sessionId, fileAttachments as Array<{ type: 'file', data: string, mimeType: string, name: string }>)
  const userContent = buildUserContent(textToSend, imageAttachments.map(a => ({ data: a.data, mimeType: a.mimeType })))

  const hookContext: any = {
    message: textToSend,
    composedMessage: textToSend,
    contexts: [],
    input: { data: {} },
  }

  sessionMessages.push({
    role: 'user',
    content: userContent as any,
    createdAt: Date.now(),
    id: nanoid(),
  })
  chatSession.persistSessionMessages(sessionId)

  const payload = {
    airiSessionId: sessionId,
    model: activeModel.value,
    stream: true as const,
    fileIds: uploadedFileIds,
    skillIds: selectedLobsterSkillIds.value,
    messages: [{ role: 'user' as const, content: userContent }],
  }
  await chatOrchestrator.emitBeforeSendHooks(textToSend, hookContext)

  const assistantMessage: any = {
    role: 'assistant',
    content: '',
    slices: [],
    tool_results: [],
    createdAt: Date.now(),
    id: nanoid(),
  }
  sessionMessages.push(assistantMessage)
  chatSession.persistSessionMessages(sessionId)

  let assistantContent = ''
  let reasoningContent = ''

  try {
    for await (const event of streamChat({
      baseUrl,
      apiKey,
      request: payload,
      onStateChange: (_state: string) => {
        // Phase 2: map to animation states
      },
      onPermissionRequest: (permPayload: {
        requestId: string
        capabilityToken: string
        toolName: string
        toolInput: Record<string, unknown>
        expiresAt: number
      }) => {
        upsertPendingLobsterPermission(permPayload)
      },
    })) {
      switch ((event as LobsterBridgeEvent).type) {
        case 'assistant.delta': {
          const delta = (event as any).payload?.delta ?? ''
          if (!delta)
            break
          assistantContent += delta
          syncAssistantMessageState(assistantMessage, assistantContent, reasoningContent)
          chatSession.persistSessionMessages(sessionId)
          await chatOrchestrator.emitTokenLiteralHooks(delta, hookContext)
          break
        }
        case 'assistant.final': {
          assistantContent = (event as any).payload?.content ?? assistantContent
          syncAssistantMessageState(assistantMessage, assistantContent, reasoningContent)
          chatSession.persistSessionMessages(sessionId)
          break
        }
        case 'reasoning.delta': {
          const delta = (event as any).payload?.delta ?? ''
          if (!delta)
            break
          reasoningContent += delta
          syncAssistantMessageState(assistantMessage, assistantContent, reasoningContent)
          chatSession.persistSessionMessages(sessionId)
          break
        }
        case 'reasoning.final': {
          reasoningContent = (event as any).payload?.content ?? reasoningContent
          syncAssistantMessageState(assistantMessage, assistantContent, reasoningContent)
          chatSession.persistSessionMessages(sessionId)
          break
        }
        case 'tool.call': {
          const toolCallEvent = event as any
          assistantMessage.slices.push({
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
          chatSession.persistSessionMessages(sessionId)
          break
        }
        case 'tool.result': {
          const toolResultEvent = event as any
          const toolCallId = String(toolResultEvent.payload?.id ?? nanoid())
          const result = typeof toolResultEvent.payload?.result === 'string'
            ? toolResultEvent.payload.result
            : JSON.stringify(toolResultEvent.payload?.result ?? {}, null, 2)
          assistantMessage.tool_results = [
            ...assistantMessage.tool_results.filter((item: any) => item.id !== toolCallId),
            { id: toolCallId, result },
          ]
          assistantMessage.slices.push({
            type: 'tool-call-result',
            id: toolCallId,
            result,
          })
          chatSession.persistSessionMessages(sessionId)
          break
        }
        case 'done':
        case 'session.bound':
        case 'state.changed':
          break
      }
    }
  }
  catch (error: unknown) {
    if (error instanceof LobsterBridgeError) {
      throw new Error(error.message)
    }
    throw error
  }

  syncAssistantMessageState(assistantMessage, assistantContent, reasoningContent)
  chatSession.persistSessionMessages(sessionId)
  await syncPendingLobsterPermissions().catch(() => {})
  await chatOrchestrator.emitStreamEndHooks(hookContext)
  await chatOrchestrator.emitAssistantResponseEndHooks(assistantMessage.content, hookContext)
}

async function handleLobsterPermissionDecision(permission: {
  requestId: string
  capabilityToken: string
}, decision: 'allow' | 'deny') {
  try {
    await respondToLobsterPermission(permission, decision)
  }
  catch (error) {
    messages.value.push({
      role: 'error',
      content: (error as Error).message,
    })
    if (activeSessionId.value)
      chatSession.persistSessionMessages(activeSessionId.value)
  }
}

// Transcription pipeline
const hearingStore = useHearingStore()
const hearingPipeline = useHearingSpeechInputPipeline()
const { transcribeForMediaStream, stopStreamingTranscription } = hearingPipeline
const { supportsStreamInput } = storeToRefs(hearingPipeline)
const { configured: hearingConfigured, autoSendEnabled, autoSendDelay, activeTranscriptionProvider } = storeToRefs(hearingStore)
const shouldUseStreamInput = computed(() => {
  if (activeTranscriptionProvider.value === 'browser-web-speech-api')
    return supportsStreamInput.value
  return supportsStreamInput.value && !!stream.value
})

// Auto-send logic
let autoSendTimeout: ReturnType<typeof setTimeout> | undefined
const pendingAutoSendText = ref('')

function clearPendingAutoSend() {
  if (autoSendTimeout) {
    clearTimeout(autoSendTimeout)
    autoSendTimeout = undefined
  }
  pendingAutoSendText.value = ''
}

async function debouncedAutoSend(text: string) {
  // Double-check auto-send is enabled before proceeding
  if (!autoSendEnabled.value) {
    clearPendingAutoSend()
    return
  }

  // Add text to pending buffer
  pendingAutoSendText.value = pendingAutoSendText.value ? `${pendingAutoSendText.value} ${text}` : text

  // Clear existing timeout
  if (autoSendTimeout) {
    clearTimeout(autoSendTimeout)
  }

  // Set new timeout
  autoSendTimeout = setTimeout(async () => {
    // Final check before sending - auto-send might have been disabled while waiting
    if (!autoSendEnabled.value) {
      clearPendingAutoSend()
      return
    }

    const textToSend = pendingAutoSendText.value.trim()
    if (textToSend && autoSendEnabled.value) {
      try {
        const providerConfig = providersStore.getProviderConfig(activeProvider.value)
        await ingest(textToSend, {
          chatProvider: await providersStore.getProviderInstance(activeProvider.value) as ChatProvider,
          model: activeModel.value,
          providerConfig,
        })
        // Clear the message input after sending
        messageInput.value = ''
        pendingAutoSendText.value = ''
      }
      catch (err) {
        console.error('[ChatArea] Auto-send error:', err)
      }
    }
    autoSendTimeout = undefined
  }, autoSendDelay.value)
}

async function handleSend() {
  if (!messageInput.value.trim() || isComposing.value) {
    if (attachments.value.length === 0)
      return
  }

  const textToSend = messageInput.value
  messageInput.value = ''
  const sendingAttachments = [...attachments.value]
  attachments.value = []

  try {
    if (activeProvider.value === 'lobster-agent') {
      await sendViaLobsterBridge(textToSend, sendingAttachments)
    }
    else {
      const providerConfig = providersStore.getProviderConfig(activeProvider.value)
      await ingest(textToSend, {
        chatProvider: await providersStore.getProviderInstance(activeProvider.value) as ChatProvider,
        model: activeModel.value,
        providerConfig,
        attachments: sendingAttachments
          .filter((item): item is ChatAttachment & { type: 'image' } => item.type === 'image')
          .map(({ data, mimeType }) => ({ type: 'image' as const, data, mimeType })),
      })
    }
  }
  catch (error) {
    messageInput.value = textToSend
    attachments.value = sendingAttachments
    messages.value.pop()
    messages.value.push({
      role: 'error',
      content: (error as Error).message,
    })
  }
}

watch(hearingTooltipOpen, async (value) => {
  if (value) {
    await askPermission()
  }
})

watch([activeProvider, activeModel], async () => {
  if (activeProvider.value && activeModel.value) {
    await discoverToolsCompatibility(activeModel.value, await providersStore.getProviderInstance<ChatProvider>(activeProvider.value), [])
  }
  if (activeProvider.value === 'lobster-agent') {
    await loadLobsterSkills().catch((error) => {
      console.warn('[ChatArea] Failed to load lobster skills:', error)
    })
    await syncPendingLobsterPermissions().catch((error) => {
      console.warn('[ChatArea] Failed to restore lobster permissions:', error)
    })
  }
  else {
    pendingLobsterPermissions.value = []
  }
}, { immediate: true })

watch(activeSessionId, async () => {
  if (activeProvider.value !== 'lobster-agent')
    return
  await syncPendingLobsterPermissions().catch((error) => {
    console.warn('[ChatArea] Failed to refresh lobster permissions for session:', error)
  })
})

watch(lobsterSkills, () => {
  syncSelectedLobsterSkillIds()
}, { deep: true })

onAfterMessageComposed(async () => {
})

const { startAnalyzer, stopAnalyzer, volumeLevel } = useAudioAnalyzer()
const normalizedVolume = computed(() => Math.min(1, Math.max(0, (volumeLevel.value ?? 0) / 100)))
let analyzerSource: MediaStreamAudioSourceNode | undefined

function teardownAnalyzer() {
  try {
    analyzerSource?.disconnect()
  }
  catch {}
  analyzerSource = undefined
  stopAnalyzer()
}

async function setupAnalyzer() {
  teardownAnalyzer()
  if (!hearingTooltipOpen.value || !enabled.value || !stream.value)
    return
  if (audioContext.state === 'suspended')
    await audioContext.resume()
  const analyser = startAnalyzer(audioContext)
  if (!analyser)
    return
  analyzerSource = audioContext.createMediaStreamSource(stream.value)
  analyzerSource.connect(analyser)
}

watch([hearingTooltipOpen, enabled, stream], () => {
  setupAnalyzer()
}, { immediate: true })

onUnmounted(() => {
  teardownAnalyzer()
  stopListening()

  // Clear auto-send timeout on unmount
  if (autoSendTimeout) {
    clearTimeout(autoSendTimeout)
    autoSendTimeout = undefined
  }
})

// Transcription listening functions
async function startListening() {
  // Allow calling this even if already listening - transcribeForMediaStream will handle session reuse/restart
  try {
    console.info('[ChatArea] Starting listening...', {
      enabled: enabled.value,
      hasStream: !!stream.value,
      supportsStreamInput: supportsStreamInput.value,
      hearingConfigured: hearingConfigured.value,
    })

    // Auto-configure Web Speech API as default if no provider is configured
    if (!hearingConfigured.value) {
      // Check if Web Speech API is available in the browser
      // Web Speech API is NOT available in Electron (stage-tamagotchi) - it requires Google's embedded API keys
      // which are not available in Electron, causing it to fail at runtime
      const isWebSpeechAvailable = typeof window !== 'undefined'
        && !isStageTamagotchi() // Explicitly exclude Electron
        && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)

      if (isWebSpeechAvailable) {
        console.info('[ChatArea] No transcription provider configured. Auto-configuring Web Speech API as default...')

        // Initialize the provider in the providers store first
        try {
          providersStore.initializeProvider('browser-web-speech-api')
        }
        catch (err) {
          console.warn('[ChatArea] Error initializing Web Speech API provider:', err)
        }

        // Set as active provider
        hearingStore.activeTranscriptionProvider = 'browser-web-speech-api'

        // Wait for reactivity to update
        await nextTick()

        // Verify the provider was set correctly
        if (hearingStore.activeTranscriptionProvider === 'browser-web-speech-api') {
          console.info('[ChatArea] Web Speech API configured as default provider')
          // Continue with transcription - Web Speech API is ready
        }
        else {
          console.error('[ChatArea] Failed to set Web Speech API as default provider')
          isListening.value = false
          return
        }
      }
      else {
        console.error('[ChatArea] Web Speech API not available. No transcription provider configured and Web Speech API is not available in this browser. Please go to Settings > Modules > Hearing to configure a transcription provider. Browser support:', {
          hasWindow: typeof window !== 'undefined',
          hasWebkitSpeechRecognition: typeof window !== 'undefined' && 'webkitSpeechRecognition' in window,
          hasSpeechRecognition: typeof window !== 'undefined' && 'SpeechRecognition' in window,
        })
        isListening.value = false
        return
      }
    }

    // Request microphone permission if needed (microphone should already be enabled by the user)
    const isWebSpeech = hearingStore.activeTranscriptionProvider === 'browser-web-speech-api'
    if (!stream.value && !isWebSpeech) {
      console.info('[ChatArea] Requesting microphone permission...')
      await askPermission()

      // If still no stream, try starting it manually
      if (!stream.value && enabled.value) {
        console.info('[ChatArea] Attempting to start stream manually...')
        startStream()
        // Wait for the stream to become available with a timeout.
        try {
          await until(stream).toBeTruthy({ timeout: 3000, throwOnTimeout: true })
        }
        catch {
          console.error('[ChatArea] Timed out waiting for audio stream.')
          isListening.value = false
          return
        }
      }
    }

    if (!stream.value && !isWebSpeech) {
      const errorMsg = 'Failed to get audio stream for transcription. Please check microphone permissions and ensure a device is selected.'
      console.error('[ChatArea]', errorMsg)
      isListening.value = false
      return
    }

    // Check if streaming input is supported
    if (!shouldUseStreamInput.value && !isWebSpeech) {
      const errorMsg = 'Streaming input not supported by the selected transcription provider. Please select a provider that supports streaming (e.g., Web Speech API).'
      console.warn('[ChatArea]', errorMsg)
      // Clean up any existing sessions from other pages (e.g., test page) that might interfere
      await stopStreamingTranscription(true)
      isListening.value = false
      return
    }

    const transcriptionStream = stream.value ?? new MediaStream()
    console.info('[ChatArea] Starting streaming transcription with stream:', transcriptionStream.id)

    // Call transcribeForMediaStream - it's async so we await it
    // Set listening state AFTER successful call
    try {
      await transcribeForMediaStream(transcriptionStream, {
        onSentenceEnd: (delta) => {
          if (delta && delta.trim()) {
            // Append transcribed text to message input
            const currentText = messageInput.value.trim()
            messageInput.value = currentText ? `${currentText} ${delta}` : delta
            console.info('[ChatArea] Received transcription delta:', delta)

            // Auto-send if enabled - check the current value (not captured in closure)
            // This ensures we always respect the current setting, even if callbacks are reused
            if (autoSendEnabled.value) {
              debouncedAutoSend(delta)
            }
            else {
              // If auto-send is disabled, clear any pending auto-send text to prevent accidental sends
              clearPendingAutoSend()
            }
          }
        },
        // Omit onSpeechEnd to avoid re-adding user-deleted text; use sentence deltas only.
      })

      // Only set listening to true if transcription started successfully
      // (transcribeForMediaStream might return early if session already exists)
      isListening.value = true
      console.info('[ChatArea] Streaming transcription initiated successfully')
    }
    catch (err) {
      console.error('[ChatArea] Transcription error:', err)
      isListening.value = false
      throw err // Re-throw to be caught by outer catch
    }
  }
  catch (err) {
    console.error('[ChatArea] Failed to start transcription:', err)
    isListening.value = false
  }
}

async function stopListening() {
  if (!isListening.value)
    return

  try {
    console.info('[ChatArea] Stopping transcription...')

    // Clear auto-send timeout
    clearPendingAutoSend()

    // Send any pending text immediately if auto-send is enabled
    if (autoSendEnabled.value && pendingAutoSendText.value.trim()) {
      const textToSend = pendingAutoSendText.value.trim()
      pendingAutoSendText.value = ''
      try {
        const providerConfig = providersStore.getProviderConfig(activeProvider.value)
        await ingest(textToSend, {
          chatProvider: await providersStore.getProviderInstance(activeProvider.value) as ChatProvider,
          model: activeModel.value,
          providerConfig,
        })
        messageInput.value = ''
      }
      catch (err) {
        console.error('[ChatArea] Auto-send error on stop:', err)
      }
    }

    await stopStreamingTranscription(true)
    isListening.value = false
    console.info('[ChatArea] Transcription stopped')
  }
  catch (err) {
    console.error('[ChatArea] Error stopping transcription:', err)
    isListening.value = false
  }
}

// Start listening when microphone is enabled and stream is available
watch(enabled, async (val) => {
  if (val && stream.value) {
    // Microphone was just enabled and we have a stream, start transcription
    await startListening()
  }
  else if (!val && isListening.value) {
    // Microphone was disabled, stop transcription
    await stopListening()
  }
})

// Start listening when stream becomes available (if microphone is enabled)
watch(stream, async (val) => {
  if (val && enabled.value && !isListening.value) {
    // Stream became available and microphone is enabled, start transcription
    await startListening()
  }
  else if (!val && isListening.value) {
    // Stream was lost, stop transcription
    await stopListening()
  }
})

// Watch for auto-send setting changes and clear pending sends if disabled
watch(autoSendEnabled, (enabled) => {
  if (!enabled) {
    // Auto-send was disabled - clear any pending auto-send
    clearPendingAutoSend()
    console.info('[ChatArea] Auto-send disabled, cleared pending text')
  }
})
</script>

<template>
  <div h="<md:full" flex gap-2 class="ph-no-capture">
    <div
      :class="[
        'relative',
        'w-full',
        'bg-primary-200/20 dark:bg-primary-400/20',
      ]"
    >
      <!-- Attachments Preview -->
      <div v-if="attachments.length > 0" class="flex gap-2 overflow-x-auto px-4 pb-2 pt-4">
        <div v-for="(att, idx) in attachments" :key="idx" class="group relative shrink-0">
          <img v-if="att.type === 'image'" :src="`data:${att.mimeType};base64,${att.data}`" class="h-16 w-16 border border-neutral-200 rounded-md object-cover shadow-sm dark:border-neutral-700">
          <div v-else class="h-16 min-w-24 flex items-center border border-neutral-200 rounded-md bg-neutral-50 px-2 text-xs shadow-sm dark:border-neutral-700 dark:bg-neutral-800">
            {{ att.name }}
          </div>
          <button
            class="absolute rounded-full bg-red-500 p-0.5 text-white opacity-0 shadow-sm transition-opacity -right-1.5 -top-1.5 hover:bg-red-600 group-hover:opacity-100"
            @click="removeAttachment(idx)"
          >
            <div class="i-ph:x h-3 w-3" />
          </button>
        </div>
      </div>

      <BasicTextarea
        v-model="messageInput"
        :placeholder="t('stage.message')"
        text="primary-600 dark:primary-100  placeholder:primary-500 dark:placeholder:primary-200"
        bg="transparent"
        min-h="[100px]" max-h="[300px]" w-full
        rounded-t-xl p-4 font-medium
        outline-none transition="all duration-250 ease-in-out placeholder:all placeholder:duration-250 placeholder:ease-in-out"
        :class="{
          'transition-colors-none placeholder:transition-colors-none': themeColorsHueDynamic,
        }"
        @submit="handleSend"
        @compositionstart="isComposing = true"
        @compositionend="isComposing = false"
      />

      <LobsterSkillsBar
        :visible="activeProvider === 'lobster-agent'"
        :total-skills-count="totalSkillsCount"
        :enabled-skills-count="enabledSkillsCount"
        @open-settings="openLobsterSkillsSettings"
      />

      <LobsterPermissionList
        :visible="activeProvider === 'lobster-agent' && pendingLobsterPermissions.length > 0"
        :permissions="pendingLobsterPermissions"
        @decide="handleLobsterPermissionDecision"
      />

      <ChatInputControls
        :enabled="enabled"
        :is-listening="isListening"
        :normalized-volume="normalizedVolume"
        :total-skills-count="totalSkillsCount"
        :enabled-skills-count="enabledSkillsCount"
        :active-provider="activeProvider"
        :audio-inputs="audioInputs"
        :selected-audio-input="selectedAudioInput"
        :hearing-tooltip-open="hearingTooltipOpen"
        @files-selected="handleFileChange"
        @update-hearing-tooltip-open="hearingTooltipOpen = $event"
        @update-selected-audio-input="selectedAudioInput = $event"
        @toggle-listening="toggleMicrophoneEnabled"
      />
    </div>
  </div>
</template>
