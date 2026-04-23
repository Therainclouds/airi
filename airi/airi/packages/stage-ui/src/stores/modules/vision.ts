import { defineStore } from 'pinia'
import { computed, shallowRef, ref } from 'vue'

export type CameraFrameStatus = 'idle' | 'requesting-permission' | 'previewing' | 'capturing' | 'denied' | 'error' | 'unsupported'
export type CameraFramePermissionState = 'idle' | 'granted' | 'denied' | 'unsupported'

interface CaptureFrameOptions {
  mimeType?: string
  quality?: number
  maxWidth?: number
  maxHeight?: number
  throttleMs?: number
  bypassThrottle?: boolean
}

function isCameraSupported() {
  return typeof navigator !== 'undefined'
    && typeof navigator.mediaDevices?.getUserMedia === 'function'
    && typeof navigator.mediaDevices?.enumerateDevices === 'function'
}

function stopMediaStream(stream?: MediaStream) {
  if (!stream)
    return
  stream.getTracks().forEach(track => track.stop())
}

function resolveCameraErrorMessage(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError')
      return 'permission-denied'
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError')
      return 'device-not-found'
    if (error.name === 'NotReadableError' || error.name === 'TrackStartError')
      return 'device-busy'
    if (error.name === 'OverconstrainedError' || error.name === 'ConstraintNotSatisfiedError')
      return 'device-unavailable'
  }

  if (error instanceof Error && error.message.trim())
    return error.message.trim()

  return 'camera-unavailable'
}

function normalizeCaptureSize(videoWidth: number, videoHeight: number, maxWidth: number, maxHeight: number) {
  const safeWidth = Math.max(1, videoWidth)
  const safeHeight = Math.max(1, videoHeight)
  const widthRatio = maxWidth > 0 ? maxWidth / safeWidth : 1
  const heightRatio = maxHeight > 0 ? maxHeight / safeHeight : 1
  const scale = Math.min(1, widthRatio, heightRatio)

  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  }
}

export const useVisionStore = defineStore('modules:vision:camera-frame', () => {
  const status = ref<CameraFrameStatus>(isCameraSupported() ? 'idle' : 'unsupported')
  const permissionState = ref<CameraFramePermissionState>(isCameraSupported() ? 'idle' : 'unsupported')
  const previewStream = shallowRef<MediaStream>()
  const devices = shallowRef<MediaDeviceInfo[]>([])
  const selectedDeviceId = ref('')
  const errorCode = ref('')
  const isStartingPreview = ref(false)
  const isStoppingPreview = ref(false)
  const isCaptureInFlight = ref(false)
  const autoCaptureEnabled = ref(false)
  const speechAutoAttachEnabled = ref(false)
  const autoCaptureIntervalMs = ref(2000)
  const captureCount = ref(0)
  const captureFailureCount = ref(0)
  const captureThrottleCount = ref(0)
  const lastCaptureAt = ref(0)
  const lastFrameDataUrl = ref<string>('')
  const lastFrameCapturedAt = ref(0)
  const autoSendEnabled = ref(false)
  const autoSendDelayMs = ref(5000)
  const isAutoSendPending = ref(false)
  const isAutoSendInFlight = ref(false)

  const isSupported = computed(() => isCameraSupported())
  const isPreviewing = computed(() => status.value === 'previewing' || status.value === 'capturing')
  const canCapture = computed(() => status.value === 'previewing')
  const hasUsableCapability = computed(() => isSupported.value && permissionState.value !== 'unsupported')
  const hasLastFrame = computed(() => !!lastFrameDataUrl.value && Date.now() - lastFrameCapturedAt.value < 3600000)

  async function refreshDevices() {
    if (!isSupported.value) {
      devices.value = []
      return
    }

    const mediaDevices = await navigator.mediaDevices.enumerateDevices()
    devices.value = mediaDevices.filter(device => device.kind === 'videoinput')
  }

  async function startPreview(deviceId?: string) {
    if (!isSupported.value) {
      status.value = 'unsupported'
      permissionState.value = 'unsupported'
      errorCode.value = 'camera-unsupported'
      return
    }

    if (isStartingPreview.value)
      return

    if (previewStream.value && status.value === 'previewing')
      return

    isStartingPreview.value = true
    errorCode.value = ''
    status.value = 'requesting-permission'

    try {
      if (previewStream.value)
        await stopPreview()

      const constraints: MediaStreamConstraints = {
        audio: false,
        video: deviceId
          ? { deviceId: { exact: deviceId } }
          : { facingMode: 'user' },
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      previewStream.value = stream
      permissionState.value = 'granted'
      selectedDeviceId.value = stream.getVideoTracks()[0]?.getSettings().deviceId ?? deviceId ?? ''
      status.value = 'previewing'
      await refreshDevices()
    }
    catch (error) {
      const nextErrorCode = resolveCameraErrorMessage(error)
      errorCode.value = nextErrorCode
      permissionState.value = nextErrorCode === 'permission-denied' ? 'denied' : permissionState.value
      status.value = nextErrorCode === 'permission-denied' ? 'denied' : 'error'
      stopMediaStream(previewStream.value)
      previewStream.value = undefined
      if (status.value === 'error')
        await refreshDevices().catch(() => {})
    }
    finally {
      isStartingPreview.value = false
    }
  }

  async function stopPreview() {
    if (isStoppingPreview.value)
      return

    isStoppingPreview.value = true
    try {
      stopMediaStream(previewStream.value)
      previewStream.value = undefined
      errorCode.value = ''
      isAutoSendPending.value = false
      isAutoSendInFlight.value = false
      if (status.value !== 'denied' && status.value !== 'unsupported')
        status.value = 'idle'
    }
    finally {
      isStoppingPreview.value = false
    }
  }

  async function captureFrame(videoElement: HTMLVideoElement, options: CaptureFrameOptions = {}) {
    if (!previewStream.value || !canCapture.value)
      throw new Error('camera-preview-inactive')
    if (!videoElement.videoWidth || !videoElement.videoHeight)
      throw new Error('camera-frame-unavailable')
    if (isCaptureInFlight.value) {
      captureThrottleCount.value += 1
      throw new Error('camera-capture-in-flight')
    }

    const throttleMs = options.throttleMs ?? autoCaptureIntervalMs.value
    const now = Date.now()
    if (!options.bypassThrottle && throttleMs > 0 && lastCaptureAt.value > 0 && now - lastCaptureAt.value < throttleMs) {
      captureThrottleCount.value += 1
      throw new Error('camera-capture-throttled')
    }

    status.value = 'capturing'
    isCaptureInFlight.value = true
    errorCode.value = ''

    try {
      const mimeType = options.mimeType ?? 'image/jpeg'
      const quality = options.quality ?? 0.9
      const maxWidth = options.maxWidth ?? 1280
      const maxHeight = options.maxHeight ?? 1280
      const { width, height } = normalizeCaptureSize(videoElement.videoWidth, videoElement.videoHeight, maxWidth, maxHeight)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context)
        throw new Error('camera-frame-context-unavailable')
      context.drawImage(videoElement, 0, 0, width, height)
      const dataUrl = canvas.toDataURL(mimeType, quality)
      lastCaptureAt.value = now
      captureCount.value += 1
      status.value = 'previewing'
      return {
        dataUrl,
        mimeType,
        width,
        height,
      }
    }
    catch (error) {
      captureFailureCount.value += 1
      errorCode.value = resolveCameraErrorMessage(error)
      status.value = previewStream.value ? 'previewing' : 'error'
      throw error
    }
    finally {
      isCaptureInFlight.value = false
    }
  }

  function setSelectedDevice(deviceId: string) {
    selectedDeviceId.value = deviceId
  }

  function resetError() {
    errorCode.value = ''
    if (status.value === 'error')
      status.value = previewStream.value ? 'previewing' : 'idle'
  }

  function setAutoCaptureEnabled(value: boolean) {
    autoCaptureEnabled.value = value
  }

  function setSpeechAutoAttachEnabled(value: boolean) {
    speechAutoAttachEnabled.value = value
  }

  function setLastCapturedFrame(dataUrl: string) {
    lastFrameDataUrl.value = dataUrl
    lastFrameCapturedAt.value = Date.now()
    isAutoSendPending.value = true
  }

  function clearLastCapturedFrame() {
    lastFrameDataUrl.value = ''
    lastFrameCapturedAt.value = 0
    isAutoSendPending.value = false
  }

  function setAutoSendEnabled(value: boolean) {
    autoSendEnabled.value = value
    if (!value)
      isAutoSendPending.value = false
  }

  function setAutoSendDelayMs(value: number) {
    autoSendDelayMs.value = value
  }

  function markAutoSendIdle() {
    isAutoSendPending.value = false
    isAutoSendInFlight.value = false
  }

  function markAutoSendInFlight() {
    isAutoSendInFlight.value = true
    isAutoSendPending.value = false
  }

  return {
    status,
    permissionState,
    previewStream,
    devices,
    selectedDeviceId,
    errorCode,
    autoCaptureEnabled,
    speechAutoAttachEnabled,
    autoCaptureIntervalMs,
    captureCount,
    captureFailureCount,
    captureThrottleCount,
    lastCaptureAt,
    lastFrameDataUrl,
    lastFrameCapturedAt,
    autoSendEnabled,
    autoSendDelayMs,
    isAutoSendPending,
    isAutoSendInFlight,
    isCaptureInFlight,
    isSupported,
    isPreviewing,
    canCapture,
    hasUsableCapability,
    hasLastFrame,
    refreshDevices,
    startPreview,
    stopPreview,
    captureFrame,
    setSelectedDevice,
    resetError,
    setAutoCaptureEnabled,
    setSpeechAutoAttachEnabled,
    setLastCapturedFrame,
    clearLastCapturedFrame,
    setAutoSendEnabled,
    setAutoSendDelayMs,
    markAutoSendIdle,
    markAutoSendInFlight,
  }
})
