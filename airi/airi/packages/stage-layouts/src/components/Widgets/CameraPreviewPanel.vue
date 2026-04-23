<script setup lang="ts">
import { useVisionStore } from '@proj-airi/stage-ui/stores/modules/vision'
import { storeToRefs } from 'pinia'
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { createCameraFrameAttachment } from './camera-frame-attachments'

const emit = defineEmits<{
  captured: [attachment: ReturnType<typeof createCameraFrameAttachment>]
  close: []
  minimize: []
}>()

const { t } = useI18n()
const visionStore = useVisionStore()
const { status, previewStream, errorCode, isSupported, devices, selectedDeviceId, autoCaptureEnabled, speechAutoAttachEnabled, autoCaptureIntervalMs } = storeToRefs(visionStore)
const videoRef = ref<HTMLVideoElement>()
const localCaptureError = ref('')
let autoCaptureTimer: ReturnType<typeof setInterval> | undefined

const isPreviewing = computed(() => status.value === 'previewing' || status.value === 'capturing')
const isBusy = computed(() => status.value === 'requesting-permission' || status.value === 'capturing')
const statusClass = computed(() => {
  if (status.value === 'previewing' || status.value === 'capturing')
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
  if (status.value === 'requesting-permission')
    return 'bg-primary-100 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300'
  if (status.value === 'denied')
    return 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
  if (status.value === 'error')
    return 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
  return 'bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
})
const statusLabel = computed(() => {
  if (status.value === 'requesting-permission')
    return t('stage.camera.requestingPermission')
  if (status.value === 'capturing')
    return t('stage.camera.capturing')
  if (status.value === 'previewing')
    return t('stage.camera.previewing')
  if (status.value === 'denied')
    return t('stage.camera.permissionDenied')
  if (status.value === 'unsupported')
    return t('stage.camera.unsupported')
  if (status.value === 'error')
    return t(`stage.camera.errors.${errorCode.value || 'cameraUnavailable'}`)
  return t('stage.camera.idle')
})

function detachVideoStream() {
  if (videoRef.value)
    videoRef.value.srcObject = null
}

function clearAutoCaptureTimer() {
  if (autoCaptureTimer) {
    clearInterval(autoCaptureTimer)
    autoCaptureTimer = undefined
  }
}

watch(previewStream, async (stream) => {
  localCaptureError.value = ''
  if (!videoRef.value)
    return

  if (!stream) {
    detachVideoStream()
    return
  }

  videoRef.value.srcObject = stream
  try {
    await videoRef.value.play()
  }
  catch {
    localCaptureError.value = t('stage.camera.startFailed')
  }
}, { immediate: true })

onUnmounted(() => {
  clearAutoCaptureTimer()
  detachVideoStream()
})

async function handleStartPreview() {
  localCaptureError.value = ''
  await visionStore.startPreview(selectedDeviceId.value || undefined)
}

async function handleStopPreview() {
  localCaptureError.value = ''
  await visionStore.stopPreview()
}

async function handleCapture() {
  await captureFrame(true)
}

async function captureFrame(bypassThrottle = false) {
  if (!videoRef.value)
    return

  localCaptureError.value = ''

  try {
    const frame = await visionStore.captureFrame(videoRef.value, { bypassThrottle })
    emit('captured', createCameraFrameAttachment(frame.dataUrl))
  }
  catch (error) {
    if (error instanceof Error && error.message === 'camera-capture-throttled')
      return
    localCaptureError.value = error instanceof Error && error.message === 'camera-frame-too-large'
      ? t('stage.camera.tooLarge')
      : t('stage.camera.captureFailed')
  }
}

async function handleSelectedDeviceChange(event: Event) {
  const target = event.target as HTMLSelectElement | null
  const nextDeviceId = target?.value ?? ''
  visionStore.setSelectedDevice(nextDeviceId)

  if (isPreviewing.value)
    await visionStore.startPreview(nextDeviceId || undefined)
}

watch([isPreviewing, autoCaptureEnabled, autoCaptureIntervalMs], async ([previewing, enabled]) => {
  clearAutoCaptureTimer()
  if (!previewing || !enabled)
    return

  await captureFrame(false)
  autoCaptureTimer = setInterval(() => {
    void captureFrame(false)
  }, autoCaptureIntervalMs.value)
}, { immediate: true })
</script>

<template>
  <div class="mx-4 mb-2 flex flex-col gap-3 border border-primary-300/30 rounded-xl bg-white/70 p-3 shadow-sm dark:border-primary-500/20 dark:bg-neutral-900/60">
    <div class="flex items-start justify-between gap-3">
      <div class="space-y-1">
        <div class="text-sm text-neutral-900 font-medium dark:text-neutral-100">
          {{ t('stage.camera.debugPanelTitle') }}
        </div>
        <div class="text-xs text-neutral-500 dark:text-neutral-400">
          {{ t('stage.camera.privacyHint') }}
        </div>
      </div>
      <div class="flex items-center gap-1">
        <button
          class="h-8 w-8 flex items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          :title="t('stage.camera.minimize')"
          @click="emit('minimize')"
        >
          <div class="i-ph:caret-down h-4 w-4" />
        </button>
        <button
          class="h-8 w-8 flex items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          :title="t('stage.camera.close')"
          @click="emit('close')"
        >
          <div class="i-ph:x h-4 w-4" />
        </button>
      </div>
    </div>

    <div class="flex items-center gap-2 text-xs">
      <span
        class="inline-flex items-center rounded-full px-2.5 py-1 font-medium"
        :class="statusClass"
      >
        {{ statusLabel }}
      </span>
      <span class="text-neutral-500 dark:text-neutral-400">
        {{ t('stage.camera.sendHint') }}
      </span>
    </div>

    <div class="overflow-hidden rounded-xl bg-neutral-950/90">
      <video
        v-if="isSupported"
        ref="videoRef"
        autoplay
        muted
        playsinline
        class="max-h-56 min-h-48 w-full object-cover"
      />
      <div v-else class="min-h-48 flex items-center justify-center px-4 text-sm text-neutral-300">
        {{ t('stage.camera.unsupported') }}
      </div>
    </div>

    <div v-if="devices.length > 1" class="space-y-2">
      <div class="text-xs text-neutral-500 dark:text-neutral-400">
        {{ t('stage.camera.multiDeviceHint', { count: devices.length }) }}
      </div>
      <label class="flex flex-col gap-1 text-xs text-neutral-500 dark:text-neutral-400">
        <span>{{ t('stage.camera.device') }}</span>
        <select
          class="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 outline-none transition focus:border-primary-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200"
          :value="selectedDeviceId"
          @change="handleSelectedDeviceChange"
        >
          <option
            v-for="(device, index) in devices"
            :key="device.deviceId || index"
            :value="device.deviceId"
          >
            {{ device.label || `${t('stage.camera.deviceFallback')} ${index + 1}` }}
          </option>
        </select>
      </label>
    </div>

    <div v-if="localCaptureError" class="text-xs text-red-500 dark:text-red-400">
      {{ localCaptureError }}
    </div>

    <div class="grid gap-2 sm:grid-cols-2">
      <button
        class="rounded-lg border px-3 py-2 text-left text-sm transition"
        :class="autoCaptureEnabled
          ? 'border-primary-300 bg-primary-50 text-primary-700 dark:border-primary-500/30 dark:bg-primary-500/10 dark:text-primary-200'
          : 'border-neutral-200 bg-white text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200'"
        @click="visionStore.setAutoCaptureEnabled(!autoCaptureEnabled)"
      >
        <div class="font-medium">
          {{ autoCaptureEnabled ? t('stage.camera.autoCaptureOn') : t('stage.camera.autoCaptureOff') }}
        </div>
        <div class="mt-1 text-xs opacity-70">
          {{ t('stage.camera.autoCaptureHint') }}
        </div>
      </button>

      <button
        class="rounded-lg border px-3 py-2 text-left text-sm transition"
        :class="speechAutoAttachEnabled
          ? 'border-primary-300 bg-primary-50 text-primary-700 dark:border-primary-500/30 dark:bg-primary-500/10 dark:text-primary-200'
          : 'border-neutral-200 bg-white text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200'"
        @click="visionStore.setSpeechAutoAttachEnabled(!speechAutoAttachEnabled)"
      >
        <div class="font-medium">
          {{ speechAutoAttachEnabled ? t('stage.camera.speechAttachOn') : t('stage.camera.speechAttachOff') }}
        </div>
        <div class="mt-1 text-xs opacity-70">
          {{ t('stage.camera.speechAttachHint') }}
        </div>
      </button>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <button
        v-if="!isPreviewing"
        class="rounded-lg bg-primary-500 px-3 py-2 text-sm text-white font-medium transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-primary-500 dark:hover:bg-primary-400"
        :disabled="isBusy"
        @click="handleStartPreview"
      >
        {{ t('stage.camera.start') }}
      </button>
      <button
        v-else
        class="rounded-lg bg-neutral-200 px-3 py-2 text-sm text-neutral-700 font-medium transition hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
        :disabled="isBusy"
        @click="handleStopPreview"
      >
        {{ t('stage.camera.stop') }}
      </button>

      <button
        class="rounded-lg border border-primary-300/50 bg-primary-50 px-3 py-2 text-sm text-primary-700 font-medium transition hover:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-primary-500/30 dark:bg-primary-500/10 dark:text-primary-200 dark:hover:bg-primary-500/15"
        :disabled="!isPreviewing || isBusy"
        @click="handleCapture"
      >
        {{ t('stage.camera.capture') }}
      </button>
    </div>
  </div>
</template>
