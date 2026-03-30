<script setup lang="ts">
import type { CommonContentPart } from '@xsai/shared-chat'

import { Collapsible } from '@proj-airi/ui'
import { computed, ref } from 'vue'

const props = defineProps<{
  result?: string | CommonContentPart[]
  isError?: boolean
}>()

const expanded = ref(false)
const previewLineLimit = 18
const copyState = ref<'idle' | 'copied' | 'error'>('idle')

const formattedResult = computed(() => {
  const value = props.result
  if (Array.isArray(value)) {
    try {
      return JSON.stringify(value, null, 2).trim()
    }
    catch {
      return String(value)
    }
  }

  if (typeof value !== 'string')
    return ''

  try {
    const parsed = JSON.parse(value)
    return JSON.stringify(parsed, null, 2).trim()
  }
  catch {
    return value
  }
})

const isJsonResult = computed(() => {
  const value = props.result
  if (Array.isArray(value))
    return true
  if (typeof value !== 'string')
    return false
  try {
    JSON.parse(value)
    return true
  }
  catch {
    return false
  }
})

const resultLines = computed(() => formattedResult.value.split('\n'))
const isTruncated = computed(() => resultLines.value.length > previewLineLimit)
const displayedResult = computed(() => {
  if (expanded.value || !isTruncated.value)
    return formattedResult.value
  return resultLines.value.slice(0, previewLineLimit).join('\n')
})
const resultStats = computed(() => `${formattedResult.value.length} chars · ${resultLines.value.length} lines`)
const hasContent = computed(() => !!formattedResult.value.trim())
const looksLikeError = computed(() => {
  if (props.isError)
    return true
  const text = formattedResult.value.toLowerCase()
  return text.includes('error') || text.includes('failed') || text.includes('traceback')
})

async function handleCopy() {
  if (!hasContent.value)
    return
  try {
    await navigator.clipboard.writeText(formattedResult.value)
    copyState.value = 'copied'
  }
  catch {
    copyState.value = 'error'
  }
  setTimeout(() => {
    copyState.value = 'idle'
  }, 1600)
}
</script>

<template>
  <Collapsible
    :class="[
      'bg-primary-100/20 dark:bg-primary-900/40 rounded-lg px-2 pb-2 pt-2',
      'flex flex-col gap-2 items-start',
    ]"
  >
    <template #trigger="{ visible, setVisible }">
      <button
        :class="[
          'w-full text-start text-sm text-primary-700 dark:text-primary-100',
        ]"
        @click="setVisible(!visible)"
      >
        <div i-solar:document-text-bold-duotone class="mr-1 inline-block translate-y-1 op-60" />
        <span>工具结果</span>
      </button>
    </template>
    <div
      :class="[
        'rounded-md p-2 w-full',
        looksLikeError
          ? 'bg-red-50/90 text-red-900 dark:bg-red-950/40 dark:text-red-100'
          : 'bg-neutral-100/80 text-sm text-neutral-800 dark:bg-neutral-900/80 dark:text-neutral-200',
      ]"
    >
      <div class="mb-2 flex items-center justify-between gap-2 text-[11px] text-neutral-500 dark:text-neutral-400">
        <span>{{ isJsonResult ? 'JSON / Structured Output' : 'Plain Text Output' }}</span>
        <div class="flex items-center gap-2">
          <span>{{ resultStats }}</span>
          <button
            class="rounded-md bg-primary-500/10 px-2 py-1 text-[11px] text-primary-700 transition-colors dark:text-primary-100"
            :disabled="!hasContent"
            @click="handleCopy"
          >
            {{ copyState === 'copied' ? '已复制' : copyState === 'error' ? '复制失败' : '复制' }}
          </button>
        </div>
      </div>
      <div class="whitespace-pre-wrap break-words font-mono">
        {{ displayedResult }}
      </div>
      <div v-if="isTruncated" class="mt-2 flex justify-end">
        <button
          class="rounded-md bg-primary-500/10 px-2 py-1 text-[11px] text-primary-700 transition-colors dark:text-primary-100"
          @click="expanded = !expanded"
        >
          {{ expanded ? '收起结果' : '展开完整结果' }}
        </button>
      </div>
    </div>
  </Collapsible>
</template>
