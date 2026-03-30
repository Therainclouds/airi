<script setup lang="ts">
import type { ChatProvider } from '@xsai-ext/providers/utils'

import { isStageTamagotchi } from '@proj-airi/stage-shared'
import { useAudioAnalyzer } from '@proj-airi/stage-ui/composables'
import { confirmLobsterSkillInstall, downloadLobsterSkill, loadLobsterSkills as fetchLobsterSkills, getLobsterSkillConfig, listLobsterPendingPermissions, respondLobsterPermission, setLobsterSkillConfig, setLobsterSkillEnabled } from '@proj-airi/stage-ui/services/lobster-bridge'
import { useAudioContext } from '@proj-airi/stage-ui/stores/audio'
import { useChatOrchestratorStore } from '@proj-airi/stage-ui/stores/chat'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useHearingSpeechInputPipeline, useHearingStore } from '@proj-airi/stage-ui/stores/modules/hearing'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { useSettings, useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings'
import { BasicTextarea, FieldSelect } from '@proj-airi/ui'
import { until } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { TooltipContent, TooltipProvider, TooltipRoot, TooltipTrigger } from 'reka-ui'
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import IndicatorMicVolume from './IndicatorMicVolume.vue'

const messageInput = ref('')
const hearingTooltipOpen = ref(false)
const isComposing = ref(false)
const isListening = ref(false) // Transcription listening state (separate from microphone enabled)

interface ChatAttachment { type: 'image' | 'file', data: string, mimeType: string, name: string }
const attachments = ref<ChatAttachment[]>([])
const fileInput = ref<HTMLInputElement>()
const lobsterSkills = ref<Array<{ id: string, name: string, enabled?: boolean, description?: string, version?: string }>>([])
const selectedLobsterSkillIds = ref<string[]>([])
const lobsterSkillConfigTexts = ref<Record<string, string>>({})
const lobsterSkillLoadingIds = ref<string[]>([])
const lobsterSkillSavingIds = ref<string[]>([])
const lobsterSkillSource = ref('')
const lobsterSkillInstallLoading = ref(false)
const lobsterSkillInstallFeedback = ref<null | { type: 'success' | 'error' | 'info', message: string }>(null)
const pendingSkillInstall = ref<null | {
  pendingInstallId: string
  riskLevel: string
  riskScore: number
  skillName: string
  findings: Array<{ severity: string, dimension: string, description: string, file: string, line?: number }>
}>(null)
interface PendingPermissionState {
  requestId: string
  toolName: string
  toolInput: Record<string, unknown>
  createdAt: number
}
const permissionSubmitting = ref(false)
const permissionStatusMessage = ref<null | { type: 'info' | 'error', message: string }>(null)

function handleFileClick() {
  fileInput.value?.click()
}

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
const { ingest, onAfterMessageComposed, onBridgePermissionRequest, discoverToolsCompatibility } = chatOrchestrator
const { messages } = storeToRefs(chatSession)
const { audioContext } = useAudioContext()
const { t } = useI18n()

async function loadLobsterSkills() {
  if (activeProvider.value !== 'lobster-agent')
    return
  const providerConfig = providersStore.getProviderConfig(activeProvider.value) as Record<string, any>
  lobsterSkills.value = await fetchLobsterSkills(providerConfig)
  selectedLobsterSkillIds.value = lobsterSkills.value.filter(item => item.enabled).map(item => item.id)
}

async function ensureLobsterSkillConfigLoaded(skillId: string) {
  if (!skillId || lobsterSkillConfigTexts.value[skillId] !== undefined || lobsterSkillLoadingIds.value.includes(skillId))
    return
  lobsterSkillLoadingIds.value = [...lobsterSkillLoadingIds.value, skillId]
  try {
    const providerConfig = providersStore.getProviderConfig(activeProvider.value) as Record<string, any>
    const config = await getLobsterSkillConfig(providerConfig, skillId)
    lobsterSkillConfigTexts.value = {
      ...lobsterSkillConfigTexts.value,
      [skillId]: Object.entries(config).map(([key, value]) => `${key}=${value}`).join('\n'),
    }
  }
  catch (error) {
    console.error('[ChatArea] Failed to load lobster skill config:', error)
    lobsterSkillConfigTexts.value = {
      ...lobsterSkillConfigTexts.value,
      [skillId]: '',
    }
  }
  finally {
    lobsterSkillLoadingIds.value = lobsterSkillLoadingIds.value.filter(id => id !== skillId)
  }
}

function parseSkillConfigText(raw: string) {
  return Object.fromEntries(
    raw
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separatorIndex = line.indexOf('=')
        if (separatorIndex < 0)
          return [line, '']
        return [line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim()]
      })
      .filter(([key]) => !!key),
  ) as Record<string, string>
}

async function saveLobsterSkillConfig(skillId: string) {
  if (!skillId || lobsterSkillSavingIds.value.includes(skillId))
    return
  lobsterSkillSavingIds.value = [...lobsterSkillSavingIds.value, skillId]
  try {
    const providerConfig = providersStore.getProviderConfig(activeProvider.value) as Record<string, any>
    await setLobsterSkillConfig(providerConfig, skillId, parseSkillConfigText(lobsterSkillConfigTexts.value[skillId] || ''))
  }
  catch (error) {
    console.error('[ChatArea] Failed to save lobster skill config:', error)
  }
  finally {
    lobsterSkillSavingIds.value = lobsterSkillSavingIds.value.filter(id => id !== skillId)
  }
}

async function toggleLobsterSkillEnabled(skillId: string, enabled: boolean) {
  try {
    const providerConfig = providersStore.getProviderConfig(activeProvider.value) as Record<string, any>
    const skills = await setLobsterSkillEnabled(providerConfig, skillId, enabled)
    lobsterSkills.value = normalizeSkillList(skills)
  }
  catch (error) {
    console.error('[ChatArea] Failed to toggle lobster skill:', error)
  }
}

function normalizeSkillList(skills: any[]) {
  return skills.map((item: any) => ({
    id: String(item.id || ''),
    name: String(item.name || item.id || ''),
    enabled: !!item.enabled,
    description: typeof item.description === 'string' ? item.description : '',
    version: typeof item.version === 'string' ? item.version : '',
  })).filter((item: { id: string }) => !!item.id)
}

async function handleDownloadLobsterSkill() {
  if (!lobsterSkillSource.value.trim() || lobsterSkillInstallLoading.value)
    return
  lobsterSkillInstallLoading.value = true
  lobsterSkillInstallFeedback.value = null
  try {
    const providerConfig = providersStore.getProviderConfig(activeProvider.value) as Record<string, any>
    const result = await downloadLobsterSkill(providerConfig, lobsterSkillSource.value.trim())
    if (result.skills.length > 0) {
      lobsterSkills.value = normalizeSkillList(result.skills)
      selectedLobsterSkillIds.value = lobsterSkills.value.filter(item => item.enabled).map(item => item.id)
      lobsterSkillInstallFeedback.value = {
        type: 'success',
        message: `技能已安装，共同步 ${result.skills.length} 个技能。`,
      }
      lobsterSkillSource.value = ''
      pendingSkillInstall.value = null
      return
    }
    if (result.pendingInstallId && result.auditReport) {
      pendingSkillInstall.value = {
        pendingInstallId: result.pendingInstallId,
        riskLevel: result.auditReport.riskLevel,
        riskScore: result.auditReport.riskScore,
        skillName: result.auditReport.skillName,
        findings: result.auditReport.findings || [],
      }
      lobsterSkillInstallFeedback.value = {
        type: 'info',
        message: `检测到 ${result.auditReport.riskLevel} 风险，请确认后再安装。`,
      }
    }
  }
  catch (error) {
    console.error('[ChatArea] Failed to download lobster skill:', error)
    lobsterSkillInstallFeedback.value = {
      type: 'error',
      message: error instanceof Error ? error.message : '技能安装请求失败',
    }
  }
  finally {
    lobsterSkillInstallLoading.value = false
  }
}

async function handleConfirmLobsterSkillInstall(action: 'install' | 'installDisabled' | 'cancel') {
  if (!pendingSkillInstall.value || lobsterSkillInstallLoading.value)
    return
  lobsterSkillInstallLoading.value = true
  lobsterSkillInstallFeedback.value = null
  try {
    const providerConfig = providersStore.getProviderConfig(activeProvider.value) as Record<string, any>
    const result = await confirmLobsterSkillInstall(providerConfig, pendingSkillInstall.value.pendingInstallId, action)
    if (result.skills.length > 0) {
      lobsterSkills.value = normalizeSkillList(result.skills)
      selectedLobsterSkillIds.value = lobsterSkills.value.filter(item => item.enabled).map(item => item.id)
      lobsterSkillInstallFeedback.value = {
        type: 'success',
        message: action === 'installDisabled'
          ? `技能已安装，但默认保持禁用。`
          : `技能已完成安装并刷新列表。`,
      }
    }
    else if (action === 'cancel') {
      lobsterSkillInstallFeedback.value = {
        type: 'info',
        message: '已取消本次技能安装。',
      }
    }
    pendingSkillInstall.value = null
    lobsterSkillSource.value = ''
  }
  catch (error) {
    console.error('[ChatArea] Failed to confirm lobster skill install:', error)
    lobsterSkillInstallFeedback.value = {
      type: 'error',
      message: error instanceof Error ? error.message : '技能安装确认失败',
    }
  }
  finally {
    lobsterSkillInstallLoading.value = false
  }
}

function summarizeToolInput(toolInput: Record<string, unknown>) {
  try {
    return JSON.stringify(toolInput, null, 2)
  }
  catch {
    return '[toolInput unavailable]'
  }
}

function resolvePermissionDisplayName(toolName: string, toolInput: Record<string, unknown>) {
  const context = typeof toolInput.context === 'object' && toolInput.context ? toolInput.context as Record<string, unknown> : null
  const requestedToolName = typeof context?.requestedToolName === 'string' ? context.requestedToolName : ''
  return requestedToolName || toolName || 'unknown-tool'
}

function updateActiveSessionPendingPermission(next: PendingPermissionState | null) {
  const activeSessionId = chatSession.activeSessionId
  if (!activeSessionId)
    return
  const meta = chatSession.getSessionMeta(activeSessionId)
  if (!meta)
    return
  chatSession.patchSessionMeta(activeSessionId, {
    bridgeState: {
      ...meta.bridgeState,
      pendingPermission: next,
    },
  })
}

const pendingPermission = computed<PendingPermissionState | null>(() => {
  const activeSessionId = chatSession.activeSessionId
  if (!activeSessionId)
    return null
  const meta = chatSession.getSessionMeta(activeSessionId)
  return meta?.bridgeState?.pendingPermission ?? null
})

const pendingPermissionCreatedLabel = computed(() => {
  if (!pendingPermission.value)
    return ''
  return new Date(pendingPermission.value.createdAt).toLocaleTimeString()
})

async function syncPendingPermissionState() {
  if (activeProvider.value !== 'lobster-agent') {
    permissionStatusMessage.value = null
    return
  }
  try {
    const providerConfig = providersStore.getProviderConfig(activeProvider.value) as Record<string, any>
    const permissions = await listLobsterPendingPermissions(providerConfig, chatSession.activeSessionId)
    const currentRequestId = pendingPermission.value?.requestId || ''
    const matched = currentRequestId
      ? permissions.find((item: { requestId: string }) => item.requestId === currentRequestId) || null
      : null
    const resolved = matched || permissions[0] || null

    if (resolved) {
      updateActiveSessionPendingPermission({
        requestId: resolved.requestId,
        toolName: resolved.toolName,
        toolInput: resolved.toolInput,
        createdAt: resolved.createdAt,
      })
      permissionStatusMessage.value = resolved.expiresAt
        ? { type: 'info', message: `请求有效，服务端过期时间 ${new Date(resolved.expiresAt).toLocaleTimeString()}` }
        : null
      return
    }

    if (pendingPermission.value) {
      permissionStatusMessage.value = { type: 'error', message: '该权限请求已过期、已失效或已被处理。' }
      updateActiveSessionPendingPermission(null)
    }
    else {
      permissionStatusMessage.value = null
    }
  }
  catch (error) {
    console.error('[ChatArea] Failed to sync lobster permission state:', error)
    permissionStatusMessage.value = { type: 'error', message: '无法确认权限请求状态，请重新触发。' }
  }
}

async function handlePermissionDecision(decision: 'allow' | 'deny') {
  if (!pendingPermission.value || permissionSubmitting.value)
    return
  permissionSubmitting.value = true
  try {
    const providerConfig = providersStore.getProviderConfig(activeProvider.value) as Record<string, any>
    await respondLobsterPermission(providerConfig, chatSession.activeSessionId, pendingPermission.value.requestId, decision)
    updateActiveSessionPendingPermission(null)
    permissionStatusMessage.value = null
  }
  catch (error) {
    console.error('[ChatArea] Failed to respond lobster permission:', error)
  }
  finally {
    permissionSubmitting.value = false
  }
}

onBridgePermissionRequest(async (event) => {
  updateActiveSessionPendingPermission({
    requestId: event.requestId,
    toolName: event.toolName,
    toolInput: event.toolInput,
    createdAt: Date.now(),
  })
  permissionStatusMessage.value = null
})

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
    const providerConfig = providersStore.getProviderConfig(activeProvider.value)
    await ingest(textToSend, {
      chatProvider: await providersStore.getProviderInstance(activeProvider.value) as ChatProvider,
      model: activeModel.value,
      providerConfig,
      attachments: sendingAttachments
        .filter((item): item is ChatAttachment & { type: 'image' } => item.type === 'image')
        .map(({ data, mimeType }) => ({ type: 'image' as const, data, mimeType })),
      lobster: activeProvider.value === 'lobster-agent'
        ? {
            skillIds: selectedLobsterSkillIds.value,
            fileAttachments: sendingAttachments
              .filter((item): item is ChatAttachment & { type: 'file' } => item.type === 'file')
              .map(({ data, mimeType, name }) => ({ type: 'file' as const, data, mimeType, name })),
          }
        : undefined,
    })
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
  }
})

watch(selectedLobsterSkillIds, async (ids) => {
  if (activeProvider.value !== 'lobster-agent')
    return
  await Promise.all(ids.map(async id => await ensureLobsterSkillConfigLoaded(id)))
}, { immediate: true })

watch([() => chatSession.activeSessionId, pendingPermission, activeProvider], async () => {
  await syncPendingPermissionState()
}, { immediate: true })

onAfterMessageComposed(async () => {
})

const { startAnalyzer, stopAnalyzer, volumeLevel } = useAudioAnalyzer()
const normalizedVolume = computed(() => Math.min(1, Math.max(0, (volumeLevel.value ?? 0) / 100)))
const selectedLobsterSkills = computed(() => lobsterSkills.value.filter(skill => selectedLobsterSkillIds.value.includes(skill.id)))
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
        rounded-t-xl p-4 font-medium pb="[60px]"
        outline-none transition="all duration-250 ease-in-out placeholder:all placeholder:duration-250 placeholder:ease-in-out"
        :class="{
          'transition-colors-none placeholder:transition-colors-none': themeColorsHueDynamic,
        }"
        @submit="handleSend"
        @compositionstart="isComposing = true"
        @compositionend="isComposing = false"
      />

      <div v-if="activeProvider === 'lobster-agent' && lobsterSkills.length > 0" class="flex flex-wrap gap-2 px-4 pb-2">
        <button
          v-for="skill in lobsterSkills"
          :key="skill.id"
          class="border rounded-full px-2 py-1 text-xs transition-colors"
          :class="selectedLobsterSkillIds.includes(skill.id) ? 'bg-primary-500/15 border-primary-400 text-primary-700 dark:text-primary-200' : 'bg-neutral-100 dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-600 dark:text-neutral-300'"
          @click="selectedLobsterSkillIds = selectedLobsterSkillIds.includes(skill.id) ? selectedLobsterSkillIds.filter(id => id !== skill.id) : [...selectedLobsterSkillIds, skill.id]"
        >
          {{ skill.name }}
        </button>
      </div>

      <div v-if="activeProvider === 'lobster-agent'" class="mx-4 mb-2 border border-primary-200/70 rounded-xl bg-primary-50/40 p-3 shadow-sm dark:border-primary-800/40 dark:bg-primary-950/20">
        <div class="text-sm text-primary-800 font-semibold dark:text-primary-100">
          安装 Lobster 技能
        </div>
        <div class="mt-1 text-[11px] text-primary-900/70 dark:text-primary-100/70">
          支持 GitHub 仓库、zip、本地目录或 npm package spec
        </div>
        <div class="mt-2 flex gap-2">
          <input
            v-model="lobsterSkillSource"
            class="w-full border border-primary-200 rounded-lg bg-white/80 px-3 py-2 text-xs outline-none dark:border-primary-800/50 dark:bg-neutral-900/60"
            placeholder="例如：owner/repo 或 https://... 或 本地目录"
          >
          <button
            class="rounded-lg bg-primary-500 px-3 py-2 text-xs text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="lobsterSkillInstallLoading || !lobsterSkillSource.trim()"
            @click="handleDownloadLobsterSkill"
          >
            {{ lobsterSkillInstallLoading ? '处理中...' : '安装' }}
          </button>
        </div>
      </div>

      <div
        v-if="lobsterSkillInstallFeedback"
        class="mx-4 mb-2 rounded-xl p-3 text-xs shadow-sm"
        :class="lobsterSkillInstallFeedback.type === 'success'
          ? 'border border-emerald-300 bg-emerald-50/90 text-emerald-900 dark:border-emerald-700/60 dark:bg-emerald-950/30 dark:text-emerald-100'
          : lobsterSkillInstallFeedback.type === 'error'
            ? 'border border-red-300 bg-red-50/90 text-red-900 dark:border-red-700/60 dark:bg-red-950/30 dark:text-red-100'
            : 'border border-primary-300 bg-primary-50/90 text-primary-900 dark:border-primary-700/60 dark:bg-primary-950/30 dark:text-primary-100'"
      >
        {{ lobsterSkillInstallFeedback.message }}
      </div>

      <div v-if="pendingSkillInstall" class="mx-4 mb-2 border border-rose-300 rounded-xl bg-rose-50/90 p-3 text-sm shadow-sm dark:border-rose-700/60 dark:bg-rose-950/30">
        <div class="mb-1 flex items-center justify-between gap-2 text-rose-800 dark:text-rose-200">
          <span class="font-semibold">技能安装需要风险确认</span>
          <span class="rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px]">{{ pendingSkillInstall.riskLevel }} · {{ pendingSkillInstall.riskScore }}</span>
        </div>
        <div class="text-xs text-rose-900/80 dark:text-rose-100/80">
          技能：{{ pendingSkillInstall.skillName }}
        </div>
        <div v-if="pendingSkillInstall.findings.length > 0" class="mt-2 max-h-32 overflow-auto rounded-lg bg-black/5 p-2 text-[11px] text-neutral-700 dark:bg-white/5 dark:text-neutral-200">
          <div
            v-for="(finding, index) in pendingSkillInstall.findings.slice(0, 6)"
            :key="`${finding.file}-${index}`"
            class="mb-1"
          >
            [{{ finding.severity }}] {{ finding.dimension }} - {{ finding.description }} ({{ finding.file }}<span v-if="finding.line">:{{ finding.line }}</span>)
          </div>
        </div>
        <div class="mt-3 flex gap-2">
          <button
            class="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="lobsterSkillInstallLoading"
            @click="handleConfirmLobsterSkillInstall('install')"
          >
            继续安装
          </button>
          <button
            class="rounded-lg bg-amber-500 px-3 py-1.5 text-xs text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="lobsterSkillInstallLoading"
            @click="handleConfirmLobsterSkillInstall('installDisabled')"
          >
            安装但禁用
          </button>
          <button
            class="rounded-lg bg-red-500 px-3 py-1.5 text-xs text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="lobsterSkillInstallLoading"
            @click="handleConfirmLobsterSkillInstall('cancel')"
          >
            取消
          </button>
        </div>
      </div>

      <div v-if="activeProvider === 'lobster-agent' && selectedLobsterSkills.length > 0" class="mx-4 mb-2 flex flex-col gap-2">
        <div
          v-for="skill in selectedLobsterSkills"
          :key="`skill-config-${skill.id}`"
          class="border border-primary-200/70 rounded-xl bg-primary-50/60 p-3 shadow-sm dark:border-primary-800/40 dark:bg-primary-950/20"
        >
          <div class="flex items-center justify-between gap-2">
            <div>
              <div class="text-sm text-primary-800 font-semibold dark:text-primary-100">
                {{ skill.name }}
              </div>
              <div v-if="skill.description || skill.version" class="text-[11px] text-primary-800/70 dark:text-primary-200/70">
                {{ skill.description || 'Lobster Skill' }}<span v-if="skill.version"> · {{ skill.version }}</span>
              </div>
            </div>
            <button
              class="rounded-lg px-2 py-1 text-[11px] transition-colors"
              :class="skill.enabled ? 'bg-emerald-500 text-white' : 'bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-100'"
              @click="toggleLobsterSkillEnabled(skill.id, !skill.enabled)"
            >
              {{ skill.enabled ? '已启用' : '未启用' }}
            </button>
          </div>
          <div class="mt-2 text-[11px] text-primary-900/70 dark:text-primary-100/70">
            配置格式：每行一个 KEY=VALUE
          </div>
          <textarea
            v-model="lobsterSkillConfigTexts[skill.id]"
            class="mt-2 min-h-24 w-full border border-primary-200 rounded-lg bg-white/80 p-2 text-xs outline-none dark:border-primary-800/50 dark:bg-neutral-900/60"
            :placeholder="lobsterSkillLoadingIds.includes(skill.id) ? '正在加载配置...' : '例如：API_KEY=xxx'"
          />
          <div class="mt-2 flex justify-end">
            <button
              class="rounded-lg bg-primary-500 px-3 py-1.5 text-xs text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="lobsterSkillLoadingIds.includes(skill.id) || lobsterSkillSavingIds.includes(skill.id)"
              @click="saveLobsterSkillConfig(skill.id)"
            >
              {{ lobsterSkillSavingIds.includes(skill.id) ? '保存中...' : '保存配置' }}
            </button>
          </div>
        </div>
      </div>

      <div
        v-if="permissionStatusMessage && activeProvider === 'lobster-agent'"
        class="mx-4 mb-2 rounded-xl p-3 text-xs shadow-sm"
        :class="permissionStatusMessage.type === 'error'
          ? 'border border-red-300 bg-red-50/90 text-red-900 dark:border-red-700/60 dark:bg-red-950/30 dark:text-red-100'
          : 'border border-amber-300 bg-amber-50/90 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100'"
      >
        {{ permissionStatusMessage.message }}
      </div>

      <div v-if="pendingPermission && activeProvider === 'lobster-agent'" class="mx-4 mb-2 border border-amber-300 rounded-xl bg-amber-50/90 p-3 text-sm shadow-sm dark:border-amber-700/60 dark:bg-amber-950/30">
        <div class="mb-1 flex items-center justify-between gap-2 text-amber-800 dark:text-amber-200">
          <div class="flex items-center gap-2">
            <div class="i-ph:warning-circle h-4 w-4" />
            <span class="font-semibold">Lobster 权限确认</span>
          </div>
          <span class="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px]">
            会话 {{ chatSession.activeSessionId.slice(0, 8) }}
          </span>
        </div>
        <div class="text-xs text-amber-900/80 dark:text-amber-100/80">
          工具：{{ resolvePermissionDisplayName(pendingPermission.toolName, pendingPermission.toolInput) }}
        </div>
        <div class="mt-1 text-[11px] text-amber-900/70 dark:text-amber-100/70">
          请求创建于 {{ pendingPermissionCreatedLabel }}，仅对当前会话有效；切换或刷新后会按会话恢复，失效请求默认拒绝。
        </div>
        <pre class="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-black/5 p-2 text-[11px] text-neutral-700 dark:bg-white/5 dark:text-neutral-200">{{ summarizeToolInput(pendingPermission.toolInput) }}</pre>
        <div class="mt-3 flex flex-wrap gap-2">
          <button
            class="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="permissionSubmitting"
            @click="handlePermissionDecision('allow')"
          >
            允许
          </button>
          <button
            class="rounded-lg bg-red-500 px-3 py-1.5 text-xs text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="permissionSubmitting"
            @click="handlePermissionDecision('deny')"
          >
            拒绝
          </button>
          <button
            class="rounded-lg bg-neutral-500 px-3 py-1.5 text-xs text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="permissionSubmitting"
            @click="handlePermissionDecision('deny')"
          >
            关闭并拒绝
          </button>
        </div>
      </div>

      <!-- Bottom-left action button: Microphone -->
      <div
        absolute bottom-2 left-2 z-10 flex items-center gap-2
      >
        <!-- File Button -->
        <input ref="fileInput" type="file" multiple class="hidden" @change="handleFileChange">
        <button
          class="h-8 w-8 flex items-center justify-center rounded-md outline-none transition-all duration-200 active:scale-95 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          text="lg neutral-500 dark:neutral-400"
          title="Attach file"
          @click="handleFileClick"
        >
          <div class="i-ph:paperclip h-5 w-5" />
        </button>

        <!-- Microphone icon button -->
        <TooltipProvider :delay-duration="0" :skip-delay-duration="0">
          <TooltipRoot v-model:open="hearingTooltipOpen">
            <TooltipTrigger as-child>
              <button
                class="h-8 w-8 flex items-center justify-center rounded-md outline-none transition-all duration-200 active:scale-95"
                text="lg neutral-500 dark:neutral-400"
                :title="t('settings.hearing.title')"
              >
                <Transition name="fade" mode="out-in">
                  <IndicatorMicVolume v-if="enabled" class="h-5 w-5" />
                  <div v-else class="i-ph:microphone-slash h-5 w-5" />
                </Transition>
              </button>
            </TooltipTrigger>
            <Transition name="fade">
              <TooltipContent
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

                <FieldSelect
                  v-model="selectedAudioInput"
                  label="Input device"
                  description="Select the microphone you want to use."
                  :options="audioInputs.map(device => ({ label: device.label || 'Unknown Device', value: device.deviceId }))"
                  layout="vertical"
                  placeholder="Select microphone"
                />
              </TooltipContent>
            </Transition>
          </TooltipRoot>
        </TooltipProvider>
      </div>
    </div>
  </div>
</template>
