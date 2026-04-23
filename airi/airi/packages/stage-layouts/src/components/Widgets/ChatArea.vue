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
import { useLobsterBridgeSessionStore } from '@proj-airi/stage-ui/stores/lobster-bridge-session'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useHearingSpeechInputPipeline, useHearingStore } from '@proj-airi/stage-ui/stores/modules/hearing'
import { useVisionStore } from '@proj-airi/stage-ui/stores/modules/vision'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { useSettings, useSettingsAudioDevice, useSettingsVision } from '@proj-airi/stage-ui/stores/settings'
import { BasicTextarea } from '@proj-airi/ui'
import { until } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import CameraPreviewPanel from './CameraPreviewPanel.vue'
import ChatInputControls from './ChatInputControls.vue'
import LobsterPermissionList from './LobsterPermissionList.vue'
import LobsterSkillsBar from './LobsterSkillsBar.vue'
import VisionStatusDock from './VisionStatusDock.vue'

import type { ChatAttachment } from './camera-frame-attachments'
import { clearCameraDraftAttachments as clearCameraDraftAttachmentsFromList, createLocalAttachmentFromFile, getCameraDraftAttachments as getCameraDraftAttachmentsFromList, getLatestCameraDraftAttachment, upsertCameraDraftAttachment } from './camera-frame-attachments'
import { CHAT_ATTACHMENT_ACCEPT, CHAT_ATTACHMENT_LIMITS, normalizeTranscriptionText, shouldAutoSendTranscription, validateChatAttachment } from './chat-input-policy'

const messageInput = ref('')
const hearingTooltipOpen = ref(false)
const isComposing = ref(false)
const isListening = ref(false) // Transcription listening state (separate from microphone enabled)
const attachments = ref<ChatAttachment[]>([])

function pushChatError(content: string) {
  messages.value.push({
    role: 'error',
    content,
  })
  if (activeSessionId.value)
    chatSession.persistSessionMessages(activeSessionId.value)
}

function resolveAttachmentValidationMessage(reason: 'too_many' | 'unsupported_type' | 'too_large' | 'bridge_only_file', attachmentType?: 'image' | 'file') {
  if (reason === 'too_many')
    return t('stage.attachments.tooMany', { count: CHAT_ATTACHMENT_LIMITS.maxAttachments })
  if (reason === 'bridge_only_file')
    return t('stage.attachments.bridgeOnly')
  if (reason === 'too_large' && attachmentType === 'image')
    return t('stage.attachments.tooLargeImage', { size: CHAT_ATTACHMENT_LIMITS.maxImageSizeMb })
  if (reason === 'too_large')
    return t('stage.attachments.tooLargeFile', { size: CHAT_ATTACHMENT_LIMITS.maxFileSizeMb })
  return t('stage.attachments.unsupportedType')
}

async function handleFileChange(event: Event) {
  const target = event.target as HTMLInputElement
  if (!target.files?.length)
    return

  const pendingAttachments: ChatAttachment[] = []

  for (const file of Array.from(target.files)) {
    const validation = validateChatAttachment(file, {
      currentCount: attachments.value.length + pendingAttachments.length,
      supportsBridgeFiles: supportsBridgeFileAttachments.value,
    })

    if (!validation.ok) {
      pushChatError(resolveAttachmentValidationMessage(validation.reason, validation.attachmentType))
      continue
    }

    try {
      pendingAttachments.push(await createLocalAttachmentFromFile(file, validation.attachmentType))
    }
    catch {
      pushChatError(t('stage.attachments.readFailed'))
    }
  }

  if (pendingAttachments.length > 0)
    attachments.value.push(...pendingAttachments)

  target.value = ''
}

function removeAttachment(index: number) {
  attachments.value.splice(index, 1)
}

function clearCameraDraftAttachments() {
  attachments.value = clearCameraDraftAttachmentsFromList(attachments.value)
}

function getCameraDraftAttachments() {
  return getCameraDraftAttachmentsFromList(attachments.value)
}

function getVisionGreetingContent() {
  const cardGreeting = activeCard.value?.greetings?.find(greeting => greeting?.trim())?.trim()
  return cardGreeting || t('stage.camera.autoGreetingFallback')
}

function shouldSendVisionGreeting() {
  if (!cameraFrameEnabled.value || !cameraFrameAutoGreetingEnabled.value || !activeSessionId.value)
    return false
  if (greetedVisionSessions.has(activeSessionId.value))
    return false

  const sessionMessages = chatSession.getSessionMessages(activeSessionId.value)
  const visibleConversationCount = sessionMessages.filter(message => message.role === 'assistant' || message.role === 'user').length
  return visibleConversationCount === 0
}

function pushVisionGreeting() {
  if (!activeSessionId.value || !shouldSendVisionGreeting())
    return

  greetedVisionSessions.add(activeSessionId.value)
  messages.value.push({
    role: 'assistant',
    content: getVisionGreetingContent(),
    slices: [{ type: 'text', text: getVisionGreetingContent() }],
    tool_results: [],
    createdAt: Date.now(),
  })
  chatSession.persistSessionMessages(activeSessionId.value)
}

async function closeCameraPanel() {
  visionPanelExpanded.value = false
}

async function toggleCameraPanel() {
  if (!isCameraSupported.value)
    return

  visionPanelExpanded.value = !visionPanelExpanded.value
}

function handleCameraCaptured(attachment: Extract<ChatAttachment, { source: 'local', type: 'image' }>) {
  if (attachments.value.length >= CHAT_ATTACHMENT_LIMITS.maxAttachments) {
    pushChatError(t('stage.attachments.tooMany', { count: CHAT_ATTACHMENT_LIMITS.maxAttachments }))
    return
  }

  attachments.value = upsertCameraDraftAttachment(attachments.value, attachment)
  visionStore.setLastCapturedFrame(attachment.data)
  pushVisionGreeting()
  scheduleVisionAutoSend()
}

let visionAutoSendTimer: ReturnType<typeof setTimeout> | undefined

function scheduleVisionAutoSend() {
  if (!cameraFrameAutoSendEnabled.value)
    return

  cancelVisionAutoSend()
  visionAutoSendCountdownMs.value = cameraFrameAutoSendDelayMs.value

  const tickInterval = setInterval(() => {
    visionAutoSendCountdownMs.value -= 100
    if (visionAutoSendCountdownMs.value <= 0) {
      visionAutoSendCountdownMs.value = 0
      clearInterval(tickInterval)
    }
  }, 100)

  visionAutoSendTimer = setTimeout(() => {
    clearInterval(tickInterval)
    flushVisionAutoSend()
  }, cameraFrameAutoSendDelayMs.value)
}

function cancelVisionAutoSend() {
  if (visionAutoSendTimer) {
    clearTimeout(visionAutoSendTimer)
    visionAutoSendTimer = undefined
  }
  visionAutoSendCountdownMs.value = 0
}

async function flushVisionAutoSend() {
  if (isAutoSendInFlight.value)
    return

  const latestFrame = getLatestCameraDraftAttachment(attachments.value)
  if (!latestFrame)
    return

  visionStore.markAutoSendInFlight()

  try {
    await sendMessageToSession('', [latestFrame])
    attachments.value = clearCameraDraftAttachmentsFromList(attachments.value)
    visionStore.clearLastCapturedFrame()
  }
  catch (err) {
    pushChatError(resolveChatErrorMessage(err))
  }
  finally {
    visionStore.markAutoSendIdle()
  }
}

function handleVisionDockPause() {
  visionStore.setAutoCaptureEnabled(false)
}

function handleVisionDockClose() {
  cancelVisionAutoSend()
  visionStore.stopPreview()
  visionStore.clearLastCapturedFrame()
  visionPanelExpanded.value = false
}

function handleVisionDockExpand() {
  visionPanelExpanded.value = true
}

const providersStore = useProvidersStore()
const lobsterBridgeSession = useLobsterBridgeSessionStore()
const visionStore = useVisionStore()
const visionSettingsStore = useSettingsVision()
const airiCardStore = useAiriCardStore()
const { activeProvider, activeModel } = storeToRefs(useConsciousnessStore())
const { bridgeSystemPrompt, activeCard } = storeToRefs(airiCardStore)
const { themeColorsHueDynamic } = storeToRefs(useSettings())

const { askPermission, startStream } = useSettingsAudioDevice()
const { enabled, selectedAudioInput, stream, audioInputs } = storeToRefs(useSettingsAudioDevice())
const chatOrchestrator = useChatOrchestratorStore()
const chatSession = useChatSessionStore()
const { ingest, onAfterMessageComposed, discoverToolsCompatibility, onBridgePermissionRequest, onBridgeStateChanged } = chatOrchestrator
const { messages, activeSessionId } = storeToRefs(chatSession)
const { isSupported: isCameraSupported, isPreviewing: isCameraPreviewing, status: cameraStatus } = storeToRefs(visionStore)
const { cameraFrameEnabled, cameraFrameAutoGreetingEnabled, cameraFrameAutoCaptureIntervalMs, cameraFrameAutoSendEnabled, cameraFrameAutoSendDelayMs } = storeToRefs(visionSettingsStore)
const { lastFrameDataUrl, isAutoSendPending, isAutoSendInFlight, autoSendEnabled } = storeToRefs(visionStore)
const { audioContext } = useAudioContext()
const { t } = useI18n()
const router = useRouter()
const cameraPanelOpen = ref(false)
const visionPanelExpanded = ref(false)
const visionAutoSendCountdownMs = ref(0)
const greetedVisionSessions = new Set<string>()
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
const supportsBridgeFileAttachments = computed(() => {
  if (!isBridgeChatProvider.value)
    return false
  return getLobsterProviderConfig()?.useBridge !== false
})
const attachmentCapabilityHint = computed(() => supportsBridgeFileAttachments.value
  ? t('stage.attachments.capabilityHintBridge')
  : t('stage.attachments.capabilityHint'))

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

async function toggleMicrophoneEnabled() {
  if (enabled.value) {
    enabled.value = false
    return
  }

  try {
    await askPermission()
    enabled.value = true
  }
  catch {
    pushChatError(t('stage.microphone.permissionDenied'))
  }
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
const shouldDirectSendSpeech = computed(() => isListening.value || enabled.value || autoSendEnabled.value)
const isStartingListening = ref(false)
const isStoppingListening = ref(false)

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

async function flushPendingAutoSend() {
  if (!shouldDirectSendSpeech.value) {
    clearPendingAutoSend()
    return
  }

  const textToSend = normalizeTranscriptionText(pendingAutoSendText.value)
  if (!shouldAutoSendTranscription(textToSend)) {
    clearPendingAutoSend()
    return
  }

  const bridgePromptRequirementError = getBridgePromptRequirementError()
  if (bridgePromptRequirementError) {
    pushChatError(bridgePromptRequirementError)
    clearPendingAutoSend()
    return
  }

  const speechAttachments = visionStore.speechAutoAttachEnabled
    ? getCameraDraftAttachments()
    : []

  try {
    await sendMessageToSession(textToSend, speechAttachments)
    if (speechAttachments.length > 0)
      clearCameraDraftAttachments()
    clearPendingAutoSend()
  }
  catch (err) {
    messageInput.value = textToSend
    clearPendingAutoSend()
    pushChatError(resolveChatErrorMessage(err))
  }
}

async function debouncedAutoSend(text: string) {
  if (!shouldDirectSendSpeech.value) {
    clearPendingAutoSend()
    return
  }

  const normalizedText = normalizeTranscriptionText(text)
  if (!normalizedText)
    return

  pendingAutoSendText.value = pendingAutoSendText.value ? `${pendingAutoSendText.value} ${normalizedText}` : normalizedText

  if (autoSendTimeout) {
    clearTimeout(autoSendTimeout)
  }

  autoSendTimeout = setTimeout(async () => {
    await flushPendingAutoSend()
    autoSendTimeout = undefined
  }, shouldDirectSendSpeech.value ? Math.min(autoSendDelay.value, 150) : autoSendDelay.value)
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
    if (cameraPanelOpen.value && !visionStore.autoCaptureEnabled)
      await closeCameraPanel()
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
    attachments.value = sendingAttachments
    messages.value.pop()
    messages.value.push({
      role: 'error',
      content: resolveChatErrorMessage(error),
    })
  }
}

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
  cancelVisionAutoSend()
  visionStore.markAutoSendIdle()
})

// Transcription listening functions
async function startListening() {
  if (isListening.value || isStartingListening.value)
    return

  isStartingListening.value = true
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
      isListening.value = true
      await transcribeForMediaStream(transcriptionStream, {
        onSentenceEnd: (delta) => {
          const normalizedDelta = normalizeTranscriptionText(delta)
          if (normalizedDelta) {
            debouncedAutoSend(normalizedDelta)
          }
        },
        onSpeechPause: () => {
          if (pendingAutoSendText.value.trim()) {
            void flushPendingAutoSend()
          }
        },
      })

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
    pushChatError(t('stage.microphone.startFailed'))
  }
  finally {
    isStartingListening.value = false
  }
}

async function stopListening() {
  if ((!isListening.value && !isStartingListening.value) || isStoppingListening.value)
    return

  isStoppingListening.value = true
  try {
    console.info('[ChatArea] Stopping transcription...')

    if (pendingAutoSendText.value.trim())
      await flushPendingAutoSend()
    else
      clearPendingAutoSend()

    await stopStreamingTranscription(true)
    isListening.value = false
    console.info('[ChatArea] Transcription stopped')
  }
  catch (err) {
    console.error('[ChatArea] Error stopping transcription:', err)
    isListening.value = false
  }
  finally {
    isStoppingListening.value = false
  }
}

// Start listening when microphone is enabled and stream is available
watch(enabled, async (val) => {
  if (val && !isListening.value) {
    await startListening()
  }
  else if (!val && isListening.value) {
    await stopListening()
  }
})

watch(stream, async (val) => {
  if (val && enabled.value && !isListening.value && hearingStore.activeTranscriptionProvider !== 'browser-web-speech-api') {
    await startListening()
  }
  else if (!val && isListening.value && hearingStore.activeTranscriptionProvider !== 'browser-web-speech-api') {
    await stopListening()
  }
})

watch(autoSendEnabled, (enabled) => {
  if (!enabled) {
    clearPendingAutoSend()
  }
})

async function syncVisionAutomation() {
  visionStore.autoCaptureIntervalMs = cameraFrameAutoCaptureIntervalMs.value
  visionStore.setAutoSendEnabled(cameraFrameAutoSendEnabled.value)
  visionStore.setAutoSendDelayMs(cameraFrameAutoSendDelayMs.value)

  if (!cameraFrameEnabled.value || !isCameraSupported.value) {
    visionStore.setAutoCaptureEnabled(false)
    clearCameraDraftAttachments()
    cancelVisionAutoSend()
    return
  }

  if (typeof document !== 'undefined' && document.hidden)
    return

  visionStore.setAutoCaptureEnabled(true)

  if (!visionStore.isPreviewing && visionStore.status !== 'requesting-permission')
    await visionStore.startPreview(visionStore.selectedDeviceId || undefined)
}

watch(cameraFrameAutoCaptureIntervalMs, (value) => {
  visionStore.autoCaptureIntervalMs = value
}, { immediate: true })

watch(cameraFrameEnabled, async () => {
  await syncVisionAutomation()
}, { immediate: true })

onMounted(() => {
  if (typeof document === 'undefined')
    return

  const handleVisibilityChange = () => {
    if (document.hidden) {
      cancelVisionAutoSend()
      return
    }

    if (cameraFrameEnabled.value)
      void syncVisionAutomation()
  }

  document.addEventListener('visibilitychange', handleVisibilityChange)
  onUnmounted(() => {
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  })
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

      <CameraPreviewPanel
        v-if="visionPanelExpanded"
        @captured="handleCameraCaptured"
        @close="closeCameraPanel"
        @minimize="closeCameraPanel"
      />

      <VisionStatusDock
        :previewing="isCameraPreviewing"
        :capturing="cameraStatus === 'capturing'"
        :auto-capture-enabled="visionStore.autoCaptureEnabled"
        :countdown-ms="visionAutoSendCountdownMs"
        :sending="isAutoSendInFlight"
        :last-frame-data-url="lastFrameDataUrl"
        :status="cameraStatus"
        @pause="handleVisionDockPause"
        @close="handleVisionDockClose"
        @expand="handleVisionDockExpand"
      />

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
        :auto-send-enabled="shouldDirectSendSpeech"
        :total-skills-count="totalSkillsCount"
        :enabled-skills-count="enabledSkillsCount"
        :active-provider="activeProvider"
        :audio-inputs="audioInputs"
        :selected-audio-input="selectedAudioInput"
        :hearing-tooltip-open="hearingTooltipOpen"
        :file-accept="CHAT_ATTACHMENT_ACCEPT"
        :attachment-capability-hint="attachmentCapabilityHint"
        :camera-supported="isCameraSupported"
        :camera-active="isCameraPreviewing"
        :camera-panel-open="visionPanelExpanded"
        :camera-status="cameraStatus"
        :camera-has-draft="getCameraDraftAttachments().length > 0"
        @files-selected="handleFileChange"
        @send="handleSend"
        @toggle-camera-panel="toggleCameraPanel"
        @update-hearing-tooltip-open="hearingTooltipOpen = $event"
        @update-selected-audio-input="selectedAudioInput = $event"
        @toggle-listening="toggleMicrophoneEnabled"
      />
    </div>
  </div>
</template>
