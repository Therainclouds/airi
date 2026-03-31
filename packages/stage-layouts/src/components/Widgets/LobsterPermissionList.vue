<script setup lang="ts">
import { useI18n } from 'vue-i18n'

interface PendingPermissionItem {
  requestId: string
  capabilityToken: string
  toolName: string
  toolInput: Record<string, unknown>
  expiresAt?: number
}

defineProps<{
  visible: boolean
  permissions: PendingPermissionItem[]
}>()

const emit = defineEmits<{
  decide: [permission: PendingPermissionItem, decision: 'allow' | 'deny']
}>()

const { t } = useI18n()
</script>

<template>
  <div v-if="visible" class="flex flex-col gap-2 px-4 pb-2">
    <div
      v-for="permission in permissions"
      :key="permission.requestId"
      class="border border-amber-300/70 rounded-xl bg-amber-50/80 p-3 text-sm shadow-sm dark:border-amber-500/30 dark:bg-amber-500/10"
    >
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="text-amber-900 font-medium dark:text-amber-100">
            {{ permission.toolName || t('settings.pages.skills.lobster.permission.tool') }}
          </div>
          <div class="mt-1 whitespace-pre-wrap break-all text-xs text-amber-800/80 font-mono dark:text-amber-100/80">
            {{ JSON.stringify(permission.toolInput ?? {}, null, 2) }}
          </div>
          <div v-if="permission.expiresAt" class="mt-2 text-xs text-amber-800/70 dark:text-amber-100/70">
            {{ new Date(permission.expiresAt).toLocaleString() }}
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <button
            class="border border-emerald-400/70 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs text-white font-medium transition-colors hover:bg-emerald-600"
            @click="emit('decide', permission, 'allow')"
          >
            {{ t('settings.pages.skills.lobster.permission.allow') }}
          </button>
          <button
            class="border border-rose-400/70 rounded-lg bg-white px-3 py-1.5 text-xs text-rose-600 font-medium transition-colors dark:bg-transparent hover:bg-rose-50 dark:text-rose-200 dark:hover:bg-rose-500/10"
            @click="emit('decide', permission, 'deny')"
          >
            {{ t('settings.pages.skills.lobster.permission.deny') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
