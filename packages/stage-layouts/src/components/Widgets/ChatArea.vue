<script setup lang="ts">
import type { ChatSessionBridgeFileRef } from '@proj-airi/stage-ui/types/chat-session'
import type { ChatProvider } from '@xsai-ext/providers/utils'

import { errorMessageFrom } from '@moeru/std'
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
import { useLobsterBridgeSessionStore } from '@proj-airi/stage-ui/stores/lobster-bridge-session'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useHearingSpeechInputPipeline, useHearingStore } from '@proj-airi/stage-ui/stores/modules/hearing'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { useSettings, useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings'
<<<<<<< HEAD
import { BasicTextarea } from '@proj-airi/ui'
import { until } from '@vueuse/core'
import { storeToRefs } from 'pinia'
=======
import { BasicTextarea, FieldCombobox } from '@proj-airi/ui'
import { until, useLocalStorage } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuRoot, DropdownMenuTrigger, PopoverContent, PopoverRoot, PopoverTrigger } from 'reka-ui'
>>>>>>> origin/main
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import ChatInputControls from './ChatInputControls.vue'
import LobsterPermissionList from './LobsterPermissionList.vue'
import LobsterSkillsBar from './LobsterSkillsBar.vue'

const messageInput = ref('')
const hearingPopoverOpen = ref(false)
const isComposing = ref(false)
const isListening = ref(false) // Transcription listening state (separate from microphone enabled)
const DOUBLE_ENTER_INTERVAL_MS = 300
const TRAILING_NEWLINES_REGEX = /[\r\n]+$/
const SEND_MODES = ['enter', 'ctrl-enter', 'double-enter'] as const
type SendMode = (typeof SEND_MODES)[number]
const sendMode = useLocalStorage<SendMode>('ui/chat/settings/send-mode', 'enter')
const lastEnterTime = ref(0)

type ChatAttachment
  = | { source: 'local', type: 'image' | 'file', data: string, mimeType: string, name: string }
    | { source: 'history', type: 'file', historyFileId: string, mimeType: string, name: string, size?: number }
const attachments = ref<ChatAttachment[]>([])

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
const lobsterBridgeSession = useLobsterBridgeSessionStore()
const airiCardStore = useAiriCardStore()
const { activeProvider, activeModel } = storeToRefs(useConsciousnessStore())
const { bridgeSystemPrompt } = storeToRefs(airiCardStore)
const { themeColorsHueDynamic } = storeToRefs(useSettings())

const { askPermission, startStream } = useSettingsAudioDevice()
const { enabled, selectedAudioInput, stream, audioInputs } = storeToRefs(useSettingsAudioDevice())
const chatOrchestrator = useChatOrchestratorStore()
const chatSession = useChatSessionStore()
<<<<<<< HEAD
const { ingest, onAfterMessageComposed, discoverToolsCompatibility, onBridgePermissionRequest, onBridgeStateChanged } = chatOrchestrator
const { messages, activeSessionId } = storeToRefs(chatSession)
const { audioContext } = useAudioContext()
const { t } = useI18n()
const router = useRouter()
const { skills: lobsterSkills, totalSkillsCount, enabledSkillsCount, refreshSkills: refreshLobsterSkills } = useLobsterSkills(activeProvider)
const selectedLobsterSkillIds = computed({
  get: () => lobsterBridgeSession.getSelectedSkillIds(activeSessionId.value),
  set: value => lobsterBridgeSession.setSelectedSkillIds(activeSessionId.value, value),
})
const pendingLobsterPermissions = computed(() => lobsterBridgeSession.getPendingPermissions(activeSessionId.value))
const bridgeProviderIds = ['lobster-agent', 'openclaw-agent']
const isBridgeChatProvider = computed(() => bridgeProviderIds.includes(activeProvider.value))
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

  if (isBridgeChatProvider.value) {
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

function getBridgePromptRequirementError() {
  if (!isBridgeChatProvider.value) {
    return undefined
  }

  if (getLobsterProviderConfig()?.useBridge === false) {
    return undefined
  }

  if (bridgeSystemPrompt.value.trim()) {
    return undefined
  }

  return t('settings.pages.card.openclawprompt_required_runtime')
}

async function sendMessageToSession(textToSend: string, sendingAttachments: ChatAttachment[], targetSessionId?: string) {
  const providerConfig = providersStore.getProviderConfig(activeProvider.value)

  if (isBridgeChatProvider.value) {
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
  if (!isBridgeChatProvider.value)
    return
  await refreshLobsterSkills()
  syncSelectedLobsterSkillIds()
}

function syncSelectedLobsterSkillIds() {
  const availableIds = new Set(lobsterSkills.value.map(skill => skill.id))
  lobsterBridgeSession.filterSelectedSkillIds(activeSessionId.value, availableIds)
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
  lobsterBridgeSession.replacePendingPermissions(activeSessionId.value, permissions.map(permission => ({
    requestId: String(permission.requestId || ''),
    capabilityToken: String(permission.capabilityToken || ''),
    toolName: String(permission.toolName || ''),
    toolInput: permission.toolInput ?? {},
    turnId: typeof permission.turnId === 'string' ? permission.turnId : undefined,
    createdAt: typeof permission.createdAt === 'number' ? permission.createdAt : undefined,
    expiresAt: typeof permission.expiresAt === 'number' ? permission.expiresAt : undefined,
  })).filter(permission => permission.requestId && permission.capabilityToken))
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
  lobsterBridgeSession.upsertPendingPermission(activeSessionId.value, next)
}

function removePendingLobsterPermission(requestId: string) {
  lobsterBridgeSession.removePendingPermission(activeSessionId.value, requestId)
}

async function syncPendingLobsterPermissions() {
  if (!isBridgeChatProvider.value || !activeSessionId.value) {
    lobsterBridgeSession.replacePendingPermissions(activeSessionId.value, [])
    return
  }
  const { baseUrl, apiKey } = getLobsterConnection()
  try {
    const permissions = await listPendingPermissions(baseUrl, apiKey, activeSessionId.value)
    replacePendingLobsterPermissions(permissions)
  }
  catch {
    lobsterBridgeSession.replacePendingPermissions(activeSessionId.value, [])
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
=======
const { ingest, onAfterMessageComposed } = chatOrchestrator
const { messages } = storeToRefs(chatSession)
const { audioContext } = useAudioContext()
const { t } = useI18n()
const sendModeLabels = computed<Record<SendMode, string>>(() => ({
  'enter': t('stage.send-mode.enter'),
  'ctrl-enter': t('stage.send-mode.ctrl-enter'),
  'double-enter': t('stage.send-mode.double-enter'),
}))
>>>>>>> origin/main

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
<<<<<<< HEAD
        const bridgePromptRequirementError = getBridgePromptRequirementError()
        if (bridgePromptRequirementError) {
          messages.value.push({
            role: 'error',
            content: bridgePromptRequirementError,
          })
          if (activeSessionId.value)
            chatSession.persistSessionMessages(activeSessionId.value)
          pendingAutoSendText.value = ''
          autoSendTimeout = undefined
          return
        }

        await sendMessageToSession(textToSend, [])
        messageInput.value = ''
        pendingAutoSendText.value = ''
      }
      catch (err) {
        messages.value.push({
          role: 'error',
          content: resolveChatErrorMessage(err),
        })
        if (activeSessionId.value)
          chatSession.persistSessionMessages(activeSessionId.value)
=======
        // `ingest()` resolves only after the full assistant turn finishes; clear UI/buffer now so
        // the next SentenceEnd during streaming does not append to the message we already committed.
        messageInput.value = ''
        pendingAutoSendText.value = ''
        const providerConfig = providersStore.getProviderConfig(activeProvider.value)
        await ingest(textToSend, {
          chatProvider: await providersStore.getProviderInstance(activeProvider.value) as ChatProvider,
          model: activeModel.value,
          providerConfig,
        })
      }
      catch (err) {
        console.error('[ChatArea] Auto-send error:', err)
        // Preserve any transcription that arrived while ingest was in flight (see PR review).
        messageInput.value = [textToSend, messageInput.value.trim()].filter(Boolean).join(' ')
        pendingAutoSendText.value = [textToSend, pendingAutoSendText.value.trim()].filter(Boolean).join(' ')
>>>>>>> origin/main
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

  const bridgePromptRequirementError = getBridgePromptRequirementError()
  if (bridgePromptRequirementError) {
    messages.value.push({
      role: 'error',
      content: bridgePromptRequirementError,
    })
    if (activeSessionId.value)
      chatSession.persistSessionMessages(activeSessionId.value)
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
    if (extractBridgeErrorCode(error) === 'bridge_mode_locked' && isBridgeChatProvider.value && originalSessionId && hasBridgeFiles) {
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
<<<<<<< HEAD
    attachments.value = sendingAttachments
    messages.value.pop()
    messages.value.push({
      role: 'error',
      content: resolveChatErrorMessage(error),
    })
=======
    chatSession.setSessionMessages(chatSession.activeSessionId, [
      ...messages.value.slice(0, -1),
      {
        role: 'error',
        content: errorMessageFrom(error) ?? 'Failed to send message',
      },
    ])
>>>>>>> origin/main
  }
}

function sendFromKeyboard() {
  messageInput.value = messageInput.value.replace(TRAILING_NEWLINES_REGEX, '')
  void handleSend()
}

function handleMessageInputKeydown(event: KeyboardEvent) {
  if (isComposing.value || event.key !== 'Enter')
    return

  const hasControl = event.ctrlKey || event.metaKey
  const hasShift = event.shiftKey

  switch (sendMode.value) {
    case 'enter':
      if (!hasShift && !hasControl) {
        event.preventDefault()
        sendFromKeyboard()
      }
      return
    case 'ctrl-enter':
      if (hasControl) {
        event.preventDefault()
        sendFromKeyboard()
      }
      return
    case 'double-enter':
      if (!hasShift && !hasControl) {
        const now = Date.now()
        if (now - lastEnterTime.value < DOUBLE_ENTER_INTERVAL_MS) {
          event.preventDefault()
          sendFromKeyboard()
          lastEnterTime.value = 0
        }
        else {
          lastEnterTime.value = now
        }
      }
  }
}

watch(hearingPopoverOpen, async (value) => {
  if (value) {
    await askPermission()
  }
})

<<<<<<< HEAD
watch([activeProvider, activeModel], async () => {
  if (shouldDiscoverActiveProviderToolsCompatibility()) {
    await discoverToolsCompatibility(activeModel.value, await providersStore.getProviderInstance<ChatProvider>(activeProvider.value), [])
  }
  if (isBridgeChatProvider.value) {
    await loadLobsterSkills().catch((error) => {
      console.warn('[ChatArea] Failed to load lobster skills:', error)
    })
    await syncPendingLobsterPermissions().catch((error) => {
      console.warn('[ChatArea] Failed to restore lobster permissions:', error)
    })
  }
  else {
    lobsterBridgeSession.replacePendingPermissions(activeSessionId.value, [])
  }
}, { immediate: true })

watch(activeSessionId, async () => {
  if (!isBridgeChatProvider.value)
    return
  await syncPendingLobsterPermissions().catch((error) => {
    console.warn('[ChatArea] Failed to refresh lobster permissions for session:', error)
  })
})

watch(lobsterSkills, () => {
  syncSelectedLobsterSkillIds()
}, { deep: true })

=======
>>>>>>> origin/main
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
  if (!hearingPopoverOpen.value || !enabled.value || !stream.value)
    return
  if (audioContext.state === 'suspended')
    await audioContext.resume()
  const analyser = startAnalyzer(audioContext)
  if (!analyser)
    return
  analyzerSource = audioContext.createMediaStreamSource(stream.value)
  analyzerSource.connect(analyser)
}

watch([hearingPopoverOpen, enabled, stream], () => {
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

watch(sendMode, () => {
  lastEnterTime.value = 0
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

      <div v-if="isBridgeChatProvider && sessionBridgeFiles.length > 0" class="flex flex-wrap gap-2 px-4 pb-2">
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
        :submit-on-enter="false"
        :placeholder="t('stage.message')"
        text="primary-600 dark:primary-100  placeholder:primary-500 dark:placeholder:primary-200"
        bg="transparent"
        min-h="[100px]" max-h="[300px]" w-full
        rounded-t-xl p-4 font-medium
        outline-none transition="all duration-250 ease-in-out placeholder:all placeholder:duration-250 placeholder:ease-in-out"
        :class="{
          'transition-colors-none placeholder:transition-colors-none': themeColorsHueDynamic,
        }"
        @keydown="handleMessageInputKeydown"
        @compositionstart="isComposing = true"
        @compositionend="isComposing = false"
      />

<<<<<<< HEAD
      <LobsterSkillsBar
        :visible="isBridgeChatProvider"
        :total-skills-count="totalSkillsCount"
        :enabled-skills-count="enabledSkillsCount"
        @open-settings="openLobsterSkillsSettings"
      />

      <LobsterPermissionList
        :visible="isBridgeChatProvider && pendingLobsterPermissions.length > 0"
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
=======
      <!-- Bottom-left action button: Microphone -->
      <div
        absolute bottom-2 left-2 z-10 flex items-center gap-2
      >
        <DropdownMenuRoot>
          <DropdownMenuTrigger as-child>
            <button
              :class="[
                'h-8 w-8 flex items-center justify-center rounded-md outline-none transition-all duration-200 active:scale-95',
                'text-lg text-neutral-500 dark:text-neutral-400',
              ]"
              :title="t('stage.send-mode.title')"
            >
              <div class="i-solar:keyboard-bold-duotone h-5 w-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuContent
              side="top"
              align="start"
              :side-offset="8"
              :class="[
                'z-50 min-w-[180px] rounded-xl border border-neutral-200/60 bg-neutral-50/90 p-1',
                'shadow-lg backdrop-blur-md dark:border-neutral-800/30 dark:bg-neutral-900/80',
                'flex flex-col gap-1',
              ]"
            >
              <DropdownMenuItem
                v-for="mode in SEND_MODES"
                :key="mode"
                :class="[
                  'w-full flex cursor-pointer items-center rounded-lg px-3 py-2 text-xs outline-none transition-colors',
                  'hover:bg-primary-100/60 dark:hover:bg-primary-900/40',
                  sendMode === mode ? 'bg-primary-100/60 text-primary-600 font-medium dark:bg-primary-900/40 dark:text-primary-300' : 'text-neutral-600 dark:text-neutral-300',
                ]"
                @select="sendMode = mode"
              >
                <div class="mr-2 h-4 w-4 flex items-center justify-center">
                  <div v-if="sendMode === mode" class="i-ph:check-bold h-4 w-4" />
                </div>
                <span>{{ sendModeLabels[mode] }}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenuRoot>

        <!-- Microphone icon button -->
        <PopoverRoot v-model:open="hearingPopoverOpen">
          <PopoverTrigger as-child>
            <button
              :class="[
                'h-8 w-8 flex items-center justify-center rounded-md outline-none',
                'transition-all duration-200 active:scale-95',
              ]"
              text="lg neutral-500 dark:neutral-400"
              :title="t('settings.hearing.title')"
            >
              <Transition name="fade" mode="out-in">
                <IndicatorMicVolume v-if="enabled" class="h-5 w-5" />
                <div v-else class="i-ph:microphone-slash h-5 w-5" />
              </Transition>
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            :side-offset="8"
            :class="[
              'w-72 max-w-[18rem] rounded-xl border border-neutral-200/60 bg-neutral-50/90 p-4',
              'shadow-lg backdrop-blur-md dark:border-neutral-800/30 dark:bg-neutral-900/80',
              'flex flex-col gap-3',
            ]"
          >
            <div class="flex flex-col items-center justify-center">
              <div class="relative h-28 w-28 select-none">
                <div
                  class="absolute left-1/2 top-1/2 h-20 w-20 rounded-full transition-all duration-150 -translate-x-1/2 -translate-y-1/2"
                  :style="{ transform: `translate(-50%, -50%) scale(${1 + normalizedVolume * 0.35})`, opacity: String(0.25 + normalizedVolume * 0.25) }"
                  :class="enabled ? 'bg-primary-500/15 dark:bg-primary-600/20' : 'bg-neutral-300/20 dark:bg-neutral-700/20'"
                />
                <div
                  class="absolute left-1/2 top-1/2 h-24 w-24 rounded-full transition-all duration-200 -translate-x-1/2 -translate-y-1/2"
                  :style="{ transform: `translate(-50%, -50%) scale(${1.2 + normalizedVolume * 0.55})`, opacity: String(0.15 + normalizedVolume * 0.2) }"
                  :class="enabled ? 'bg-primary-500/10 dark:bg-primary-600/15' : 'bg-neutral-300/10 dark:bg-neutral-700/10'"
                />
                <div
                  class="absolute left-1/2 top-1/2 h-28 w-28 rounded-full transition-all duration-300 -translate-x-1/2 -translate-y-1/2"
                  :style="{ transform: `translate(-50%, -50%) scale(${1.5 + normalizedVolume * 0.8})`, opacity: String(0.08 + normalizedVolume * 0.15) }"
                  :class="enabled ? 'bg-primary-500/5 dark:bg-primary-600/10' : 'bg-neutral-300/5 dark:bg-neutral-700/5'"
                />
                <button
                  class="absolute left-1/2 top-1/2 grid h-16 w-16 place-items-center rounded-full shadow-md outline-none transition-all duration-200 -translate-x-1/2 -translate-y-1/2"
                  :class="enabled
                    ? 'bg-primary-500 text-white hover:bg-primary-600 active:scale-95'
                    : 'bg-neutral-200 text-neutral-600 hover:bg-neutral-300 active:scale-95 dark:bg-neutral-700 dark:text-neutral-200'"
                  @click="enabled = !enabled"
                >
                  <div :class="enabled ? 'i-ph:microphone' : 'i-ph:microphone-slash'" class="h-6 w-6" />
                </button>
              </div>
              <p class="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
                {{ enabled ? 'Microphone enabled' : 'Microphone disabled' }}
              </p>
            </div>

            <FieldCombobox
              v-model="selectedAudioInput"
              label="Input device"
              description="Select the microphone you want to use."
              :options="audioInputs.map(device => ({ label: device.label || 'Unknown Device', value: device.deviceId }))"
              layout="vertical"
              placeholder="Select microphone"
            />
          </PopoverContent>
        </PopoverRoot>
      </div>
>>>>>>> origin/main
    </div>
  </div>
</template>
