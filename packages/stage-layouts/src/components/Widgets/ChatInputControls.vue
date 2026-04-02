<script setup lang="ts">
import { FieldSelect } from '@proj-airi/ui'
import { TooltipContent, TooltipProvider, TooltipRoot, TooltipTrigger } from 'reka-ui'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import IndicatorMicVolume from './IndicatorMicVolume.vue'

const props = defineProps<{
  enabled: boolean
  isListening: boolean
  normalizedVolume: number
  canSend: boolean
  totalSkillsCount: number
  enabledSkillsCount: number
  activeProvider: string
  audioInputs: MediaDeviceInfo[]
  selectedAudioInput?: string
  hearingTooltipOpen: boolean
}>()

const emit = defineEmits<{
  filesSelected: [event: Event]
  send: []
  toggleListening: []
  updateSelectedAudioInput: [value: string]
  updateHearingTooltipOpen: [value: boolean]
}>()

const { t } = useI18n()
const fileInput = ref<HTMLInputElement>()

const hearingTooltipModel = computed({
  get: () => props.hearingTooltipOpen,
  set: value => emit('updateHearingTooltipOpen', value),
})

function handleFileClick() {
  fileInput.value?.click()
}
</script>

<template>
  <div class="flex items-center gap-2 border-t border-primary-300/20 px-4 py-3 dark:border-primary-500/10">
    <input ref="fileInput" type="file" multiple class="hidden" @change="emit('filesSelected', $event)">
    <button
      class="h-8 w-8 flex items-center justify-center rounded-md outline-none transition-all duration-200 active:scale-95 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      text="lg neutral-500 dark:neutral-400"
      title="Attach file"
      @click="handleFileClick"
    >
      <div class="i-ph:paperclip h-5 w-5" />
    </button>

    <TooltipProvider :delay-duration="0" :skip-delay-duration="0">
      <TooltipRoot v-model:open="hearingTooltipModel">
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
                  :class="enabled ? 'bg-primary-500/8 dark:bg-primary-600/12' : 'bg-neutral-300/8 dark:bg-neutral-700/8'"
                />

                <div
                  class="absolute left-1/2 top-1/2 h-16 w-16 flex items-center justify-center border rounded-full transition-all duration-200 -translate-x-1/2 -translate-y-1/2"
                  :class="enabled
                    ? [
                      'border-primary-500/30 bg-primary-500/12 dark:border-primary-400/20 dark:bg-primary-500/15',
                      isListening ? 'shadow-[0_0_24px_rgba(59,130,246,0.35)] dark:shadow-[0_0_24px_rgba(96,165,250,0.3)]' : '',
                    ]
                    : 'border-neutral-300/40 bg-neutral-200/10 dark:border-neutral-700/30 dark:bg-neutral-800/10'"
                >
                  <Transition name="fade" mode="out-in">
                    <div
                      v-if="enabled"
                      key="mic-on"
                      class="i-ph:microphone-fill h-7 w-7"
                      :class="isListening ? 'text-primary-500 dark:text-primary-400' : 'text-neutral-500 dark:text-neutral-400'"
                    />
                    <div
                      v-else
                      key="mic-off"
                      class="i-ph:microphone-slash-fill h-7 w-7 text-neutral-400 dark:text-neutral-500"
                    />
                  </Transition>
                </div>

                <div
                  class="absolute bottom-2 left-1/2 h-1 w-16 rounded-full bg-neutral-200/60 -translate-x-1/2 dark:bg-neutral-700/40"
                >
                  <div
                    class="h-full rounded-full bg-primary-500 transition-all duration-100 dark:bg-primary-400"
                    :style="{ width: `${Math.round(normalizedVolume * 100)}%` }"
                  />
                </div>
              </div>

              <p class="text-center text-sm text-neutral-700 font-medium dark:text-neutral-200">
                {{ enabled ? t('stage.microphone.enabled') : t('stage.microphone.disabled') }}
              </p>
              <p class="mt-1 text-center text-xs text-neutral-500 dark:text-neutral-400">
                {{ enabled
                  ? (isListening ? t('stage.microphone.listening') : t('stage.microphone.standby'))
                  : t('stage.microphone.openSettingsHint') }}
              </p>
            </div>

            <FieldSelect
              v-if="audioInputs.length > 0"
              :model-value="selectedAudioInput"
              :options="audioInputs.map(device => ({ value: device.deviceId, label: device.label || t('settings.hearing.audioInput.defaultLabel') }))"
              :label="t('settings.hearing.audioInput.title')"
              @update:model-value="emit('updateSelectedAudioInput', String($event))"
            />

            <button
              class="w-full rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 active:scale-[0.98]"
              :class="enabled
                ? 'bg-primary-500 text-white hover:bg-primary-600 dark:bg-primary-500 dark:hover:bg-primary-400'
                : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700'"
              @click="emit('toggleListening')"
            >
              {{ enabled ? t('stage.microphone.disable') : t('stage.microphone.enable') }}
            </button>
          </TooltipContent>
        </Transition>
      </TooltipRoot>
    </TooltipProvider>

    <div class="ml-auto text-xs opacity-60">
      {{ activeProvider === 'lobster-agent' ? `已启用 ${enabledSkillsCount} / 总技能 ${totalSkillsCount}` : '' }}
    </div>

    <button
      v-if="canSend"
      class="h-8 w-8 flex items-center justify-center rounded-full outline-none transition-all duration-200 active:scale-95"
      bg="primary-50/80 dark:neutral-100/80 hover:neutral-50"
      text="neutral-500 hover:neutral-600 dark:neutral-900 dark:hover:neutral-800"
      title="Send message"
      aria-label="Send message"
      @click="emit('send')"
    >
      <div class="i-solar:arrow-up-outline h-5 w-5" />
    </button>
  </div>
</template>
