<script setup lang="ts">
import type { ChatSessionBridgeFileRef } from '@proj-airi/stage-ui/types/chat-session'
import type { ChatProvider } from '@xsai-ext/providers/utils'

import { isStageTamagotchi } from '@proj-airi/stage-shared'
import { useAudioAnalyzer, useLobsterSkills } from '@proj-airi/stage-ui/composables'
import {
  listPendingPermissions,
  normalizeApiKey,
  normalizeBaseUrl,
  respondPermission,
} from '@proj-airi/stage-ui/services/lobster-bridge'
import { useAudioContext } from '@proj-airi/stage-ui/stores/audio'
import { useChatOrchestratorStore } from '@proj-airi/stage-ui/stores/chat'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useHearingSpeechInputPipeline, useHearingStore } from '@proj-airi/stage-ui/stores/modules/hearing'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { useSettings, useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings'
import { BasicTextarea } from '@proj-airi/ui'
import { until } from '@vueuse/core'
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

type ChatAttachment
  = | { source: 'local', type: 'image' | 'file', data: string, mimeType: string, name: string }
    | { source: 'history', type: 'file', historyFileId: string, mimeType: string, name: string, size?: number }
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
        source: 'local',
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
const { ingest, onAfterMessageComposed, discoverToolsCompatibility, onBridgePermissionRequest, onBridgeStateChanged } = chatOrchestrator
const { messages, activeSessionId } = storeToRefs(chatSession)
const { audioContext } = useAudioContext()
const { t } = useI18n()
const router = useRouter()
const { skills: lobsterSkills, totalSkillsCount, enabledSkillsCount, refreshSkills: refreshLobsterSkills } = useLobsterSkills()
const sessionBridgeFiles = computed<ChatSessionBridgeFileRef[]>(() => {
  if (!activeSessionId.value) {
    return []
  }
  return chatSession.getSessionMeta(activeSessionId.value)?.bridgeState?.fileRefs ?? []
})
const selectedHistoryFileIds = computed(() => new Set(
  attachments.value
    .filter((attachment): attachment is Extract<ChatAttachment, { source: 'history' }> => attachment.source === 'history')
    .map(attachment => attachment.historyFileId),
))

function getLobsterProviderConfig() {
  return providersStore.getProviderConfig(activeProvider.value) as Record<string, any>
}

function shouldDiscoverActiveProviderToolsCompatibility() {
  if (!activeProvider.value || !activeModel.value) {
    return false
  }

  if (activeProvider.value === 'lobster-agent') {
    return getLobsterProviderConfig()?.useBridge === false
  }

  return true
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

function attachBridgeHistoryFile(file: ChatSessionBridgeFileRef) {
  if (selectedHistoryFileIds.value.has(file.id) || file.bindingState === 'stale') {
    return
  }
  attachments.value.push({
    source: 'history',
    type: 'file',
    historyFileId: file.id,
    mimeType: file.mimeType,
    name: file.name,
    size: file.size,
  })
}

function resolveChatErrorMessage(error: unknown) {
  const errorRecord = error && typeof error === 'object'
    ? error as Record<string, unknown>
    : null
  const errorCode = typeof errorRecord?.code === 'string'
    ? errorRecord.code
    : undefined
  const nestedMessage = typeof errorRecord?.message === 'string' && errorRecord.message.trim()
    ? errorRecord.message.trim()
    : undefined

  if (errorCode === 'bridge_mode_locked')
    return '当前会话已锁定为纯文本模式，请新建一个会话后再上传文件。'
  if (error instanceof Error && error.message) {
    return error.message
  }
  if (nestedMessage)
    return nestedMessage
  if (typeof error === 'string' && error.trim()) {
    return error
  }
  return '发送失败，请检查当前会话模式或连接配置后重试。'
}

function extractBridgeErrorCode(error: unknown) {
  if (!error || typeof error !== 'object')
    return undefined
  return typeof (error as Record<string, unknown>).code === 'string'
    ? (error as Record<string, unknown>).code as string
    : undefined
}

async function sendMessageToSession(textToSend: string, sendingAttachments: ChatAttachment[], targetSessionId?: string) {
  const providerConfig = providersStore.getProviderConfig(activeProvider.value)

  if (activeProvider.value === 'lobster-agent') {
    const { baseUrl, apiKey } = getLobsterConnection()
    const fileAttachments = sendingAttachments.filter((item): item is Extract<ChatAttachment, { source: 'local', type: 'file' }> => item.source === 'local' && item.type === 'file')
    const reattachFileRefs = sendingAttachments
      .filter((item): item is Extract<ChatAttachment, { source: 'history' }> => item.source === 'history')
      .map(({ historyFileId, name, mimeType, size }) => ({ id: historyFileId, name, mimeType, size }))
    await ingest(textToSend, {
      chatProvider: await providersStore.getProviderInstance(activeProvider.value) as ChatProvider,
      model: activeModel.value,
      providerConfig,
      attachments: sendingAttachments
        .filter((item): item is Extract<ChatAttachment, { source: 'local', type: 'image' }> => item.source === 'local' && item.type === 'image')
        .map(({ data, mimeType }) => ({ type: 'image' as const, data, mimeType })),
      bridgeOptions: {
        baseUrl,
        apiKey,
        fileAttachments,
        reattachFileRefs,
        skillIds: selectedLobsterSkillIds.value.length > 0 ? selectedLobsterSkillIds.value : undefined,
        useBridge: (providerConfig as any)?.useBridge !== false,
      },
    }, targetSessionId)
    return
  }

  await ingest(textToSend, {
    chatProvider: await providersStore.getProviderInstance(activeProvider.value) as ChatProvider,
    model: activeModel.value,
    providerConfig,
    attachments: sendingAttachments
      .filter((item): item is Extract<ChatAttachment, { source: 'local', type: 'image' }> => item.source === 'local' && item.type === 'image')
      .map(({ data, mimeType }) => ({ type: 'image' as const, data, mimeType })),
  }, targetSessionId)
}

async function loadLobsterSkills() {
  if (activeProvider.value !== 'lobster-agent')
    return
  await refreshLobsterSkills()
  syncSelectedLobsterSkillIds()
}

function syncSelectedLobsterSkillIds() {
  const availableIds = new Set(lobsterSkills.value.map(skill => skill.id))
  selectedLobsterSkillIds.value = selectedLobsterSkillIds.value.filter(id => availableIds.has(id))
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
  const originalSessionId = activeSessionId.value
  const originalSessionMessages = originalSessionId
    ? [...chatSession.getSessionMessages(originalSessionId)]
    : []

  try {
    await sendMessageToSession(textToSend, sendingAttachments, originalSessionId)
  }
  catch (error) {
    const hasBridgeFiles = sendingAttachments.some(attachment => attachment.type === 'file')
    if (extractBridgeErrorCode(error) === 'bridge_mode_locked' && activeProvider.value === 'lobster-agent' && originalSessionId && hasBridgeFiles) {
      chatSession.setSessionMessages(originalSessionId, originalSessionMessages)
      try {
        const forkSessionId = await chatSession.forkSession({
          fromSessionId: originalSessionId,
          atIndex: originalSessionMessages.length,
          reason: 'bridge-mode-locked',
        })
        if (forkSessionId) {
          chatSession.setActiveSession(forkSessionId)
          await nextTick()
          await sendMessageToSession(textToSend, sendingAttachments, forkSessionId)
          return
        }
      }
      catch (retryError) {
        error = retryError
      }
    }
    messageInput.value = textToSend
    attachments.value = sendingAttachments
    messages.value.pop()
    messages.value.push({
      role: 'error',
      content: resolveChatErrorMessage(error),
    })
  }
}

watch(hearingTooltipOpen, async (value) => {
  if (value) {
    await askPermission()
  }
})

watch([activeProvider, activeModel], async () => {
  if (shouldDiscoverActiveProviderToolsCompatibility()) {
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

// Bridge hook listeners for permission requests and state changes
onBridgePermissionRequest(async (permission) => {
  upsertPendingLobsterPermission(permission)
})

onBridgeStateChanged(async (_state) => {
  // Phase 2.5: map to animation states in Stage.vue
  // For now, just sync permissions on state changes
  if (_state === 'ask_user' || _state === 'success' || _state === 'error') {
    await syncPendingLobsterPermissions().catch(() => {})
  }
})

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
      <div v-if="attachments.length > 0" class="flex gap-2 overflow-x-auto px-4 pb-2 pt-4">
        <div v-for="(att, idx) in attachments" :key="idx" class="group relative shrink-0">
          <img v-if="att.source === 'local' && att.type === 'image'" :src="`data:${att.mimeType};base64,${att.data}`" class="h-16 w-16 border border-neutral-200 rounded-md object-cover shadow-sm dark:border-neutral-700">
          <div v-else class="h-16 min-w-24 flex flex-col justify-center border border-neutral-200 rounded-md bg-neutral-50 px-2 text-xs shadow-sm dark:border-neutral-700 dark:bg-neutral-800">
            <div>{{ att.name }}</div>
            <div v-if="att.source === 'history'" class="mt-1 text-[10px] text-primary-600 dark:text-primary-300">
              Re-attach
            </div>
          </div>
          <button
            class="absolute rounded-full bg-red-500 p-0.5 text-white opacity-0 shadow-sm transition-opacity -right-1.5 -top-1.5 hover:bg-red-600 group-hover:opacity-100"
            @click="removeAttachment(idx)"
          >
            <div class="i-ph:x h-3 w-3" />
          </button>
        </div>
      </div>

      <div v-if="activeProvider === 'lobster-agent' && sessionBridgeFiles.length > 0" class="flex flex-wrap gap-2 px-4 pb-2">
        <button
          v-for="file in sessionBridgeFiles"
          :key="file.id"
          class="border border-primary-300/60 rounded-full bg-white/70 px-3 py-1 text-xs text-primary-700 transition disabled:cursor-not-allowed dark:border-primary-500/40 dark:bg-neutral-900/50 hover:bg-primary-50 dark:text-primary-200 disabled:opacity-50"
          :disabled="selectedHistoryFileIds.has(file.id) || file.bindingState === 'stale'"
          @click="attachBridgeHistoryFile(file)"
        >
          {{ file.bindingState === 'stale' ? `需重传 · ${file.name}` : selectedHistoryFileIds.has(file.id) ? `已附加 · ${file.name}` : `重新附加 · ${file.name}` }}
        </button>
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
        :can-send="Boolean(messageInput.trim() || attachments.length > 0)"
        :total-skills-count="totalSkillsCount"
        :enabled-skills-count="enabledSkillsCount"
        :active-provider="activeProvider"
        :audio-inputs="audioInputs"
        :selected-audio-input="selectedAudioInput"
        :hearing-tooltip-open="hearingTooltipOpen"
        @files-selected="handleFileChange"
        @send="handleSend"
        @update-hearing-tooltip-open="hearingTooltipOpen = $event"
        @update-selected-audio-input="selectedAudioInput = $event"
        @toggle-listening="toggleMicrophoneEnabled"
      />
    </div>
  </div>
</template>
