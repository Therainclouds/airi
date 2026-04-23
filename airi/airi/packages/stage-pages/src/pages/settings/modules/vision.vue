<script setup lang="ts">
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useVisionStore } from '@proj-airi/stage-ui/stores/modules/vision'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { useSettingsVision } from '@proj-airi/stage-ui/stores/settings'
import { FieldCheckbox, FieldRange } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const providersStore = useProvidersStore()
const { activeProvider } = storeToRefs(useConsciousnessStore())
const { status: cameraStatus, isSupported: isCameraSupported } = storeToRefs(useVisionStore())
const { cameraFrameEnabled, cameraFrameAutoGreetingEnabled, cameraFrameAutoCaptureIntervalMs, cameraFrameAutoSendEnabled, cameraFrameAutoSendDelayMs } = storeToRefs(useSettingsVision())

const isBridgeProvider = computed(() => ['lobster-agent', 'openclaw-agent'].includes(activeProvider.value))
const isBridgeEnabled = computed(() => {
  if (!isBridgeProvider.value)
    return false
  return (providersStore.getProviderConfig(activeProvider.value) as Record<string, any>)?.useBridge !== false
})
const cameraStatusLabel = computed(() => {
  if (cameraStatus.value === 'previewing' || cameraStatus.value === 'capturing')
    return t('settings.pages.modules.vision.status.cameraPreviewing')
  if (cameraStatus.value === 'requesting-permission')
    return t('settings.pages.modules.vision.status.cameraRequesting')
  if (cameraStatus.value === 'denied')
    return t('settings.pages.modules.vision.status.cameraDenied')
  if (cameraStatus.value === 'unsupported')
    return t('settings.pages.modules.vision.status.cameraUnavailable')
  if (cameraStatus.value === 'error')
    return t('settings.pages.modules.vision.status.cameraError')
  return t('settings.pages.modules.vision.status.cameraReady')
})

const cameraCapabilityDescription = computed(() => {
  if (cameraStatus.value === 'previewing' || cameraStatus.value === 'capturing')
    return t('settings.pages.modules.vision.capabilities.liveCameraPreviewingDescription')
  if (cameraStatus.value === 'denied')
    return t('settings.pages.modules.vision.capabilities.liveCameraDeniedDescription')
  if (cameraStatus.value === 'unsupported')
    return t('settings.pages.modules.vision.capabilities.liveCameraUnavailableDescription')
  return t('settings.pages.modules.vision.capabilities.liveCameraDescription')
})

const capabilityRows = computed(() => [
  {
    title: t('settings.pages.modules.vision.capabilities.airiImagesTitle'),
    description: t('settings.pages.modules.vision.capabilities.airiImagesDescription'),
    enabled: true,
    statusLabel: t('settings.pages.modules.vision.status.enabled'),
  },
  {
    title: t('settings.pages.modules.vision.capabilities.bridgeTitle'),
    description: isBridgeEnabled.value
      ? t('settings.pages.modules.vision.capabilities.bridgeEnabledDescription')
      : t('settings.pages.modules.vision.capabilities.bridgeDisabledDescription'),
    enabled: isBridgeEnabled.value,
    statusLabel: isBridgeEnabled.value
      ? t('settings.pages.modules.vision.status.enabled')
      : t('settings.pages.modules.vision.status.notReady'),
  },
  {
    title: t('settings.pages.modules.vision.capabilities.liveCameraTitle'),
    description: cameraCapabilityDescription.value,
    enabled: isCameraSupported.value,
    statusLabel: cameraStatusLabel.value,
  },
])
</script>

<template>
  <div class="mx-auto max-w-4xl flex flex-col gap-6 px-6 py-4">
    <section class="border border-neutral-200 rounded-2xl bg-white/80 p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/70">
      <div class="flex items-start justify-between gap-4">
        <div class="space-y-2">
          <h2 class="text-xl text-neutral-900 font-semibold dark:text-neutral-100">
            {{ t('settings.pages.modules.vision.overview.title') }}
          </h2>
          <p class="text-sm text-neutral-600 dark:text-neutral-300">
            {{ t('settings.pages.modules.vision.overview.description') }}
          </p>
        </div>
        <span
          class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium"
          :class="isBridgeEnabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'"
        >
          {{ isBridgeEnabled ? t('settings.pages.modules.vision.status.bridgeReady') : t('settings.pages.modules.vision.status.bridgePartial') }}
        </span>
      </div>

      <div class="grid mt-4 gap-3 md:grid-cols-2">
        <div class="rounded-xl bg-neutral-100/80 p-4 dark:bg-neutral-800/70">
          <div class="text-xs text-neutral-500 tracking-wide uppercase dark:text-neutral-400">
            {{ t('settings.pages.modules.vision.status.currentProviderLabel') }}
          </div>
          <div class="mt-2 text-sm text-neutral-900 font-medium dark:text-neutral-100">
            {{ activeProvider || t('settings.pages.modules.vision.status.noProvider') }}
          </div>
        </div>
        <div class="rounded-xl bg-neutral-100/80 p-4 dark:bg-neutral-800/70">
          <div class="text-xs text-neutral-500 tracking-wide uppercase dark:text-neutral-400">
            {{ t('settings.pages.modules.vision.status.currentModeLabel') }}
          </div>
          <div class="mt-2 text-sm text-neutral-900 font-medium dark:text-neutral-100">
            {{ isBridgeEnabled ? t('settings.pages.modules.vision.status.currentModeBridge') : t('settings.pages.modules.vision.status.currentModeImages') }}
          </div>
        </div>
      </div>
    </section>

    <section class="grid gap-4 md:grid-cols-3">
      <article
        v-for="item in capabilityRows"
        :key="item.title"
        class="border border-neutral-200 rounded-2xl bg-white/80 p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/70"
      >
        <div class="flex items-center justify-between gap-3">
          <h3 class="text-sm text-neutral-900 font-semibold dark:text-neutral-100">
            {{ item.title }}
          </h3>
          <span
            class="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium"
            :class="item.enabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300'"
          >
            {{ item.statusLabel }}
          </span>
        </div>
        <p class="mt-3 text-sm text-neutral-600 leading-6 dark:text-neutral-300">
          {{ item.description }}
        </p>
      </article>
    </section>

    <section class="border border-neutral-200 rounded-2xl bg-white/80 p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/70">
      <div class="space-y-2">
        <h3 class="text-base text-neutral-900 font-semibold dark:text-neutral-100">
          {{ t('settings.pages.modules.vision.controls.title') }}
        </h3>
        <p class="text-sm text-neutral-600 dark:text-neutral-300">
          {{ t('settings.pages.modules.vision.controls.description') }}
        </p>
      </div>

      <div class="mt-5 space-y-4">
        <FieldCheckbox
          v-model="cameraFrameEnabled"
          :label="t('settings.pages.modules.vision.controls.enable.label')"
          :description="t('settings.pages.modules.vision.controls.enable.description')"
        />

        <FieldCheckbox
          v-if="cameraFrameEnabled"
          v-model="cameraFrameAutoGreetingEnabled"
          :label="t('settings.pages.modules.vision.controls.autoGreeting.label')"
          :description="t('settings.pages.modules.vision.controls.autoGreeting.description')"
        />

        <FieldRange
          v-if="cameraFrameEnabled"
          v-model="cameraFrameAutoCaptureIntervalMs"
          :label="t('settings.pages.modules.vision.controls.interval.label')"
          :description="t('settings.pages.modules.vision.controls.interval.description')"
          :min="1000"
          :max="5000"
          :step="500"
          :format-value="value => `${(value / 1000).toFixed(1)}s`"
        />

        <FieldCheckbox
          v-if="cameraFrameEnabled"
          v-model="cameraFrameAutoSendEnabled"
          :label="t('settings.pages.modules.vision.controls.autoSend.label')"
          :description="t('settings.pages.modules.vision.controls.autoSend.description')"
        />

        <FieldRange
          v-if="cameraFrameEnabled && cameraFrameAutoSendEnabled"
          v-model="cameraFrameAutoSendDelayMs"
          :label="t('settings.pages.modules.vision.controls.autoSendDelay.label')"
          :description="t('settings.pages.modules.vision.controls.autoSendDelay.description')"
          :min="2000"
          :max="10000"
          :step="500"
          :format-value="value => `${(value / 1000).toFixed(1)}s`"
        />
      </div>
    </section>

    <section class="border border-primary-200/70 rounded-2xl bg-primary-50/70 p-6 dark:border-primary-500/20 dark:bg-primary-500/10">
      <h3 class="text-sm text-primary-700 font-semibold dark:text-primary-300">
        {{ t('settings.pages.modules.vision.recommendations.title') }}
      </h3>
      <ul class="mt-3 flex flex-col gap-2 text-sm text-primary-700/90 leading-6 dark:text-primary-200/90">
        <li>{{ t('settings.pages.modules.vision.recommendations.imagesFirst') }}</li>
        <li>{{ t('settings.pages.modules.vision.recommendations.bridgeFiles') }}</li>
        <li>{{ t('settings.pages.modules.vision.recommendations.privacy') }}</li>
      </ul>
    </section>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.vision.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
