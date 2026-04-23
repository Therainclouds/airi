<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  previewing: boolean
  capturing: boolean
  autoCaptureEnabled: boolean
  countdownMs: number
  sending: boolean
  lastFrameDataUrl?: string
  status: 'idle' | 'requesting-permission' | 'previewing' | 'capturing' | 'denied' | 'error' | 'unsupported'
}>()

const emit = defineEmits<{
  pause: []
  close: []
  expand: []
}>()

const { t } = useI18n()

const isActive = computed(() => props.previewing || props.capturing || props.countdownMs > 0 || props.sending)
const isCountingDown = computed(() => props.countdownMs > 0 && !props.sending)
const countdownSeconds = computed(() => Math.max(0, Math.ceil(props.countdownMs / 1000)))

const statusClass = computed(() => {
  if (props.status === 'denied')
    return 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
  if (props.status === 'error')
    return 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
  if (props.capturing || props.sending)
    return 'bg-primary-100 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300'
  if (props.previewing)
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
  return 'bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
})

const statusLabel = computed(() => {
  if (props.sending)
    return t('stage.camera.sending')
  if (props.capturing)
    return t('stage.camera.capturing')
  if (props.status === 'previewing')
    return t('stage.camera.previewing')
  if (props.status === 'denied')
    return t('stage.camera.permissionDenied')
  if (props.status === 'error')
    return t('stage.camera.startFailed')
  if (props.status === 'unsupported')
    return t('stage.camera.unsupported')
  return t('stage.camera.idle')
})
</script>

<template>
  <div
    v-if="isActive || status === 'denied' || status === 'error'"
    class="vision-status-dock fixed left-4 bottom-4 z-50 w-60 flex flex-col rounded-xl border border-primary-300/30 bg-white/90 p-3 shadow-lg backdrop-blur-sm dark:border-primary-500/20 dark:bg-neutral-900/80"
  >
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <span class="inline-flex h-2 w-2 rounded-full" :class="previewing || capturing ? 'bg-emerald-500 animate-pulse' : 'bg-neutral-400'" />
        <span
          class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
          :class="statusClass"
        >
          {{ statusLabel }}
        </span>
      </div>
      <div class="flex items-center gap-1">
        <button
          v-if="autoCaptureEnabled && previewing"
          class="flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
          :title="t('stage.camera.pause')"
          @click="emit('pause')"
        >
          <div class="i-ph:pause h-4 w-4" />
        </button>
        <button
          class="flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
          :title="t('stage.camera.expand')"
          @click="emit('expand')"
        >
          <div class="i-ph:arrows-out-simple h-4 w-4" />
        </button>
        <button
          class="flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 transition hover:bg-red-100 dark:text-neutral-400 dark:hover:bg-red-900/30"
          :title="t('stage.camera.close')"
          @click="emit('close')"
        >
          <div class="i-ph:x h-4 w-4" />
        </button>
      </div>
    </div>

    <div v-if="lastFrameDataUrl" class="mt-2 flex gap-2">
      <img
        :src="lastFrameDataUrl"
        class="h-14 w-14 rounded-lg border border-neutral-200 object-cover shadow-sm dark:border-neutral-700"
      >
      <div class="flex flex-col justify-center">
        <div v-if="isCountingDown" class="text-sm text-primary-600 dark:text-primary-300">
          {{ t('stage.camera.autoSendingIn', { seconds: countdownSeconds }) }}
        </div>
        <div v-else-if="sending" class="text-sm text-primary-600 dark:text-primary-300">
          {{ t('stage.camera.sending') }}...
        </div>
        <div v-else-if="capturing" class="text-sm text-neutral-500 dark:text-neutral-400">
          {{ t('stage.camera.processing') }}
        </div>
        <div v-else class="text-sm text-neutral-500 dark:text-neutral-400">
          {{ t('stage.camera.ready') }}
        </div>
        <div class="mt-1 flex items-center gap-1 text-xs text-neutral-400 dark:text-neutral-500">
          <span v-if="autoCaptureEnabled" class="inline-flex items-center gap-0.5">
            <div class="i-ph:camera-fill h-3 w-3" />
            {{ t('stage.camera.autoCaptureOn') }}
          </span>
        </div>
      </div>
    </div>
    <div v-else-if="previewing" class="mt-2 flex items-center gap-2">
      <div class="h-14 w-14 rounded-lg border border-neutral-200 bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800">
        <div class="flex h-full w-full items-center justify-center">
          <div class="i-ph:video-camera h-6 w-6 text-neutral-400" />
        </div>
      </div>
      <div class="flex flex-col justify-center">
        <div class="text-sm text-neutral-500 dark:text-neutral-400">
          {{ t('stage.camera.waiting') }}
        </div>
        <div class="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
          {{ t('stage.camera.willCaptureSoon') }}
        </div>
      </div>
    </div>

    <div v-if="isCountingDown" class="mt-2">
      <div class="h-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
        <div
          class="h-full rounded-full bg-primary-500 transition-all duration-100 dark:bg-primary-400"
          :style="{ width: `${Math.max(0, (countdownMs / 5000) * 100)}%` }"
        />
      </div>
    </div>
  </div>
</template>