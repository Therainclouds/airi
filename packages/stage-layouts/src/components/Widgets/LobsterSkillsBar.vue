<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{
  visible: boolean
  totalSkillsCount: number
  enabledSkillsCount: number
}>()

const emit = defineEmits<{
  openSettings: []
}>()

const { t } = useI18n()
</script>

<template>
  <div v-if="visible" class="px-4 pb-2">
    <div :class="['mb-2 flex flex-wrap items-center justify-between gap-2']">
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <span class="rounded-full bg-neutral-100 px-2.5 py-1 opacity-80 dark:bg-neutral-800">
          {{ t('settings.pages.skills.lobster.total') }} {{ totalSkillsCount }}
        </span>
        <span class="rounded-full bg-emerald-500/10 px-2.5 py-1 text-emerald-700 dark:text-emerald-300">
          {{ t('settings.pages.skills.lobster.enabledCount') }} {{ enabledSkillsCount }}
        </span>
      </div>
      <button
        class="border border-primary-400/50 rounded-full bg-primary-500/10 px-3 py-1 text-xs text-primary-700 font-medium transition-colors hover:bg-primary-500/15 dark:text-primary-200"
        @click="emit('openSettings')"
      >
        {{ t('settings.pages.skills.lobster.manage') }}
      </button>
    </div>
  </div>
</template>
