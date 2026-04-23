<script setup lang="ts">
import type { LobsterSkill as LobsterSkillType } from '@proj-airi/stage-ui/composables'

import { useLobsterSkills } from '@proj-airi/stage-ui/composables'
import { Button, Callout, FieldInput } from '@proj-airi/ui'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'

interface SkillSecurityFinding {
  dimension?: string
  severity?: string
  description?: string
  file?: string
  line?: number
}

interface SkillSecurityReport {
  skillName?: string
  riskLevel?: string
  riskScore?: number
  findings?: SkillSecurityFinding[]
  scanDurationMs?: number
}

interface SkillConfigEntry {
  key: string
  value: string
}

const { t } = useI18n()
const router = useRouter()

const loading = ref(false)
const search = ref('')
const source = ref('')
const sourceLoading = ref(false)
const selectedSkillId = ref('')
const configEntries = ref<SkillConfigEntry[]>([])
const configLoading = ref(false)
const configSaving = ref(false)
const actionLoadingId = ref<string | null>(null)
const pendingInstallId = ref('')
const securityReport = ref<SkillSecurityReport | null>(null)
const installConfirming = ref(false)
const revealedSecretKeys = ref<string[]>([])
const highlightedSkillId = ref('')

const {
  skills,
  enabledSkillsCount,
  totalSkillsCount,
  baseUrl,
  providerConfig,
  refreshSkills: refreshLobsterSkills,
  setSkillEnabled,
  getSkillConfig,
  setSkillConfig,
  downloadSkill,
  confirmInstall: confirmLobsterInstall,
} = useLobsterSkills()
const isUsingDefaultKey = computed(() => !String(providerConfig.value?.apiKey || '').trim())

const filteredSkills = computed(() => {
  const query = search.value.trim().toLowerCase()
  const list = [...skills.value].sort((left, right) => {
    if (Boolean(left.enabled) === Boolean(right.enabled))
      return left.name.localeCompare(right.name)
    return left.enabled ? -1 : 1
  })
  if (!query)
    return list
  return list.filter(skill =>
    skill.name.toLowerCase().includes(query)
    || skill.id.toLowerCase().includes(query)
    || String(skill.description || '').toLowerCase().includes(query),
  )
})

const selectedSkill = computed(() => skills.value.find(skill => skill.id === selectedSkillId.value) ?? null)
const visibleSecurityFindings = computed(() => (securityReport.value?.findings ?? []).filter(item => item.severity !== 'info'))
const normalizedConfigEntries = computed(() => configEntries.value.filter(entry => entry.key.trim()))
const duplicateConfigKeys = computed(() => {
  const counts = new Map<string, number>()
  for (const entry of normalizedConfigEntries.value) {
    const key = entry.key.trim()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([key]) => key)
})

function isSecretConfigKey(key: string) {
  return /(key|token|secret|password|passphrase|credential|cookie|auth)/i.test(key)
}

function normalizeConfigEntries(config: Record<string, unknown>) {
  return Object.entries(config).map(([key, value]) => ({
    key,
    value: typeof value === 'string' ? value : JSON.stringify(value ?? ''),
  }))
}

function resetConfigEntries(config: Record<string, unknown> = {}) {
  configEntries.value = normalizeConfigEntries(config)
  revealedSecretKeys.value = []
}

function addConfigEntry() {
  configEntries.value = [...configEntries.value, { key: '', value: '' }]
}

function removeConfigEntry(index: number) {
  configEntries.value = configEntries.value.filter((_, currentIndex) => currentIndex !== index)
}

function toggleSecretVisibility(key: string) {
  if (!key)
    return
  if (revealedSecretKeys.value.includes(key)) {
    revealedSecretKeys.value = revealedSecretKeys.value.filter(item => item !== key)
    return
  }
  revealedSecretKeys.value = [...revealedSecretKeys.value, key]
}

function isSecretVisible(key: string) {
  return revealedSecretKeys.value.includes(key)
}

function toConfigPayload() {
  if (duplicateConfigKeys.value.length > 0)
    throw new Error(`${t('settings.pages.skills.lobster.duplicateKeys')}：${duplicateConfigKeys.value.join(', ')}`)
  return Object.fromEntries(
    normalizedConfigEntries.value.map(entry => [entry.key.trim(), entry.value]),
  )
}

async function refreshSkills() {
  loading.value = true
  try {
    await refreshLobsterSkills()
    if (selectedSkillId.value && !skills.value.some(skill => skill.id === selectedSkillId.value)) {
      selectedSkillId.value = ''
      resetConfigEntries()
    }
  }
  finally {
    loading.value = false
  }
}

async function highlightNewlyInstalledSkill(previousSkillIds: string[]) {
  await refreshSkills()
  const newSkill = skills.value.find(skill => !previousSkillIds.includes(skill.id))
  if (!newSkill)
    return
  highlightedSkillId.value = newSkill.id
  await openSkillConfig(newSkill.id).catch(() => {})
}

async function toggleSkill(skill: LobsterSkillType) {
  actionLoadingId.value = skill.id
  try {
    await setSkillEnabled(skill.id, !skill.enabled)
    toast.success(skill.enabled ? t('settings.pages.skills.lobster.statusDisabled') : t('settings.pages.skills.lobster.statusEnabled'))
  }
  catch (error) {
    toast.error(error instanceof Error ? error.message : t('settings.pages.skills.lobster.statusDisabled'))
  }
  finally {
    actionLoadingId.value = null
  }
}

async function openSkillConfig(skillId: string) {
  selectedSkillId.value = skillId
  configLoading.value = true
  try {
    const config = await getSkillConfig(skillId)
    resetConfigEntries(config ?? {})
  }
  catch (error) {
    toast.error(error instanceof Error ? error.message : t('settings.pages.skills.lobster.configure'))
  }
  finally {
    configLoading.value = false
  }
}

async function saveSkillConfig() {
  if (!selectedSkillId.value)
    return
  configSaving.value = true
  try {
    await setSkillConfig(selectedSkillId.value, toConfigPayload())
    toast.success(t('settings.pages.skills.lobster.saveConfig'))
  }
  catch (error) {
    toast.error(error instanceof Error ? error.message : t('settings.pages.skills.lobster.saveConfig'))
  }
  finally {
    configSaving.value = false
  }
}

async function addSkillFromSource() {
  const value = source.value.trim()
  if (!value)
    return
  sourceLoading.value = true
  try {
    const previousSkillIds = skills.value.map(skill => skill.id)
    const data = await downloadSkill(value)
    if (data?.auditReport && data?.pendingInstallId) {
      securityReport.value = data.auditReport as SkillSecurityReport
      pendingInstallId.value = String(data.pendingInstallId)
      toast.success(t('settings.pages.skills.lobster.download'))
      return
    }
    source.value = ''
    await highlightNewlyInstalledSkill(previousSkillIds)
    toast.success(t('settings.pages.skills.lobster.install'))
  }
  catch (error) {
    toast.error(error instanceof Error ? error.message : t('settings.pages.skills.lobster.download'))
  }
  finally {
    sourceLoading.value = false
  }
}

async function confirmInstall(action: 'install' | 'installDisabled' | 'cancel') {
  if (!pendingInstallId.value)
    return
  installConfirming.value = true
  try {
    const previousSkillIds = skills.value.map(skill => skill.id)
    await confirmLobsterInstall(pendingInstallId.value, action)
    pendingInstallId.value = ''
    securityReport.value = null
    source.value = ''
    if (action === 'cancel') {
      await refreshSkills()
    }
    else {
      await highlightNewlyInstalledSkill(previousSkillIds)
    }
    toast.success(action === 'cancel' ? t('settings.pages.skills.lobster.cancel') : t('settings.pages.skills.lobster.install'))
  }
  catch (error) {
    toast.error(error instanceof Error ? error.message : t('settings.pages.skills.lobster.install'))
  }
  finally {
    installConfirming.value = false
  }
}

function openProvidersSettings() {
  router.push('/settings/providers')
}

onMounted(async () => {
  await refreshSkills().catch((error) => {
    toast.error(error instanceof Error ? error.message : '技能列表加载失败')
  })
})
</script>

<template>
  <div class="h-full flex flex-col gap-4 overflow-y-auto p-4">
    <div class="grid gap-3 md:grid-cols-3">
      <div class="rounded-2xl bg-neutral-100 p-4 dark:bg-neutral-900/70">
        <div class="text-xs uppercase opacity-60">
          {{ t('settings.pages.skills.lobster.installed') }}
        </div>
        <div class="mt-2 text-3xl font-semibold">
          {{ totalSkillsCount }}
        </div>
      </div>
      <div class="rounded-2xl bg-neutral-100 p-4 dark:bg-neutral-900/70">
        <div class="text-xs uppercase opacity-60">
          {{ t('settings.pages.skills.lobster.enabledCount') }}
        </div>
        <div class="mt-2 text-3xl font-semibold">
          {{ enabledSkillsCount }}
        </div>
      </div>
      <div class="rounded-2xl bg-neutral-100 p-4 dark:bg-neutral-900/70">
        <div class="text-xs uppercase opacity-60">
          {{ t('settings.pages.skills.lobster.serviceAddress') }}
        </div>
        <div class="mt-2 break-all text-sm font-medium opacity-80">
          {{ baseUrl }}
        </div>
      </div>
    </div>

    <Callout
      v-if="isUsingDefaultKey"
      theme="orange"
      :label="t('settings.pages.skills.lobster.defaultKeyWarning')"
    >
      {{ t('settings.pages.skills.lobster.defaultKeyWarningDesc') }}
    </Callout>

    <div class="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
      <div class="flex flex-col gap-4">
        <div class="rounded-2xl bg-neutral-100 p-4 dark:bg-neutral-900/70">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div class="text-lg font-semibold">
                {{ t('settings.pages.skills.lobster.list') }}
              </div>
              <div class="text-sm opacity-70">
                {{ t('settings.pages.skills.lobster.listDesc') }}
              </div>
            </div>
            <div class="flex items-center gap-2">
              <Button
                :label="t('settings.pages.skills.lobster.providerSettings')"
                size="sm"
                variant="secondary"
                @click="openProvidersSettings"
              />
              <Button
                :label="t('settings.pages.skills.lobster.refresh')"
                size="sm"
                :loading="loading"
                @click="refreshSkills"
              />
            </div>
          </div>

          <FieldInput
            v-model="search"
            :label="t('settings.pages.skills.lobster.filter')"
            :placeholder="t('settings.pages.skills.lobster.filterPlaceholder')"
          />

          <div class="mt-4 flex flex-col gap-3">
            <div
              v-for="skill in filteredSkills"
              :key="skill.id"
              class="border rounded-2xl bg-white p-4 transition-colors dark:bg-neutral-950/60"
              :class="skill.id === highlightedSkillId ? 'border-primary-400 bg-primary-500/5 dark:border-primary-500/60 dark:bg-primary-500/10' : 'border-neutral-200 dark:border-neutral-700'"
            >
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <div class="font-medium">
                      {{ skill.name }}
                    </div>
                    <span
                      class="rounded-full px-2 py-0.5 text-xs"
                      :class="skill.enabled ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'"
                    >
                      {{ skill.enabled ? t('settings.pages.skills.lobster.statusEnabled') : t('settings.pages.skills.lobster.statusDisabled') }}
                    </span>
                    <span
                      v-if="skill.isBuiltIn"
                      class="rounded-full bg-primary-500/15 px-2 py-0.5 text-xs text-primary-700 dark:text-primary-300"
                    >
                      {{ t('settings.pages.skills.lobster.builtin') }}
                    </span>
                  </div>
                  <div class="mt-1 break-all text-xs opacity-65">
                    {{ skill.id }}
                  </div>
                  <div v-if="skill.description" class="mt-2 text-sm opacity-80">
                    {{ skill.description }}
                  </div>
                </div>

                <div class="flex items-center gap-2">
                  <Button
                    :label="skill.enabled ? t('settings.pages.skills.lobster.disable') : t('settings.pages.skills.lobster.enable')"
                    size="sm"
                    :loading="actionLoadingId === skill.id"
                    @click="toggleSkill(skill)"
                  />
                  <Button
                    :label="t('settings.pages.skills.lobster.configure')"
                    size="sm"
                    variant="secondary"
                    :loading="configLoading && selectedSkillId === skill.id"
                    @click="openSkillConfig(skill.id)"
                  />
                </div>
              </div>
            </div>

            <Callout
              v-if="!filteredSkills.length"
              theme="primary"
              :label="t('settings.pages.skills.lobster.noMatch')"
            >
              {{ t('settings.pages.skills.lobster.noMatchDesc') }}
            </Callout>
          </div>
        </div>

        <div class="rounded-2xl bg-neutral-100 p-4 dark:bg-neutral-900/70">
          <div class="text-lg font-semibold">
            {{ t('settings.pages.skills.lobster.add') }}
          </div>
          <div class="mt-1 text-sm opacity-70">
            {{ t('settings.pages.skills.lobster.addDesc') }}
          </div>

          <div class="mt-4 flex flex-col gap-3">
            <FieldInput
              v-model="source"
              :label="t('settings.pages.skills.lobster.source')"
              :placeholder="t('settings.pages.skills.lobster.sourcePlaceholder')"
            />
            <div class="flex flex-wrap gap-2">
              <Button
                :label="t('settings.pages.skills.lobster.download')"
                :loading="sourceLoading"
                @click="addSkillFromSource"
              />
              <Button
                :label="t('settings.pages.skills.lobster.clear')"
                variant="secondary"
                size="sm"
                @click="source = ''"
              />
            </div>
          </div>

          <div
            v-if="securityReport"
            class="mt-4 border border-amber-300/70 rounded-2xl bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10"
          >
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div class="text-base text-amber-900 font-semibold dark:text-amber-100">
                  {{ t('settings.pages.skills.lobster.riskConfirm') }}
                </div>
                <div class="mt-1 text-sm text-amber-900/75 dark:text-amber-100/80">
                  {{ securityReport.skillName || t('settings.pages.skills.lobster.unknown') }} · {{ t('settings.pages.skills.lobster.riskConfirm') }} {{ securityReport.riskLevel || t('settings.pages.skills.lobster.unknown') }} · {{ t('settings.pages.skills.lobster.riskConfirm') }} {{ securityReport.riskScore ?? 0 }}
                </div>
              </div>
              <div class="text-xs text-amber-900/70 dark:text-amber-100/70">
                {{ visibleSecurityFindings.length }} {{ t('settings.pages.skills.lobster.riskFindings') }}
              </div>
            </div>

            <div v-if="visibleSecurityFindings.length > 0" class="mt-3 flex flex-col gap-2">
              <div
                v-for="(finding, index) in visibleSecurityFindings.slice(0, 6)"
                :key="`${finding.file || 'finding'}-${index}`"
                class="rounded-xl bg-white/70 p-3 text-sm dark:bg-black/10"
              >
                <div class="font-medium">
                  {{ finding.dimension || t('settings.pages.skills.lobster.unknown') }} · {{ finding.severity || t('settings.pages.skills.lobster.unknown') }}
                </div>
                <div class="mt-1 opacity-80">
                  {{ finding.description || t('settings.pages.skills.lobster.noDetails') }}
                </div>
                <div v-if="finding.file" class="mt-1 text-xs opacity-60">
                  {{ finding.file }}<span v-if="finding.line">:{{ finding.line }}</span>
                </div>
              </div>
            </div>

            <div class="mt-4 flex flex-wrap gap-2">
              <Button
                :label="t('settings.pages.skills.lobster.install')"
                :loading="installConfirming"
                @click="confirmInstall('install')"
              />
              <Button
                :label="t('settings.pages.skills.lobster.installDisabled')"
                variant="secondary"
                :loading="installConfirming"
                @click="confirmInstall('installDisabled')"
              />
              <Button
                :label="t('settings.pages.skills.lobster.cancel')"
                variant="ghost"
                :loading="installConfirming"
                @click="confirmInstall('cancel')"
              />
            </div>
          </div>
        </div>
      </div>

      <div class="rounded-2xl bg-neutral-100 p-4 dark:bg-neutral-900/70">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-lg font-semibold">
              {{ t('settings.pages.skills.lobster.config') }}
            </div>
            <div class="text-sm opacity-70">
              {{ t('settings.pages.skills.lobster.configDesc') }}
            </div>
          </div>
          <Button
            v-if="selectedSkill"
            :label="t('settings.pages.skills.lobster.reRead')"
            size="sm"
            variant="secondary"
            :loading="configLoading"
            @click="openSkillConfig(selectedSkill.id)"
          />
        </div>

        <Callout
          v-if="!selectedSkill"
          class="mt-4"
          theme="primary"
          :label="t('settings.pages.skills.lobster.noSkillSelected')"
        >
          {{ t('settings.pages.skills.lobster.noSkillSelectedDesc') }}
        </Callout>

        <template v-else>
          <div class="mt-4 border border-neutral-200 rounded-2xl bg-white p-4 dark:border-neutral-700 dark:bg-neutral-950/60">
            <div class="font-medium">
              {{ selectedSkill.name }}
            </div>
            <div class="mt-1 break-all text-xs opacity-65">
              {{ selectedSkill.id }}
            </div>
          </div>

          <Callout
            v-if="duplicateConfigKeys.length > 0"
            class="mt-4"
            theme="orange"
            :label="t('settings.pages.skills.lobster.duplicateKeys')"
          >
            {{ duplicateConfigKeys.join('、') }}
          </Callout>

          <div class="mt-4 flex flex-col gap-3">
            <div
              v-for="(entry, index) in configEntries"
              :key="`${selectedSkill.id}-${index}`"
              class="border border-neutral-200 rounded-2xl bg-white p-4 dark:border-neutral-700 dark:bg-neutral-950/60"
            >
              <div class="grid gap-3 lg:grid-cols-[minmax(180px,0.9fr)_minmax(0,1.1fr)_auto]">
                <FieldInput
                  v-model="entry.key"
                  :label="t('settings.pages.skills.lobster.configKey')"
                  :placeholder="t('settings.pages.skills.lobster.configKeyPlaceholder')"
                />
                <FieldInput
                  v-model="entry.value"
                  :label="t('settings.pages.skills.lobster.configValue')"
                  :type="isSecretConfigKey(entry.key) && !isSecretVisible(entry.key) ? 'password' : 'text'"
                  :placeholder="isSecretConfigKey(entry.key) ? t('settings.pages.skills.lobster.configValueSensitive') : t('settings.pages.skills.lobster.configValuePlaceholder')"
                />
                <div class="flex flex-wrap items-end gap-2">
                  <Button
                    v-if="isSecretConfigKey(entry.key)"
                    :label="isSecretVisible(entry.key) ? t('settings.pages.skills.lobster.hide') : t('settings.pages.skills.lobster.show')"
                    variant="secondary"
                    size="sm"
                    @click="toggleSecretVisibility(entry.key)"
                  />
                  <Button
                    :label="t('settings.pages.skills.lobster.delete')"
                    variant="ghost"
                    size="sm"
                    @click="removeConfigEntry(index)"
                  />
                </div>
              </div>
            </div>

            <Callout
              v-if="configEntries.length === 0"
              theme="primary"
              :label="t('settings.pages.skills.lobster.configEmpty')"
            >
              {{ t('settings.pages.skills.lobster.configEmptyDesc') }}
            </Callout>
          </div>

          <div class="mt-3 flex flex-wrap gap-2">
            <Button
              :label="t('settings.pages.skills.lobster.saveConfig')"
              :loading="configSaving"
              @click="saveSkillConfig"
            />
            <Button
              :label="t('settings.pages.skills.lobster.addEntry')"
              variant="secondary"
              size="sm"
              @click="addConfigEntry"
            />
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.skills.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.skills.description
  icon: i-solar:widget-3-bold-duotone
  settingsEntry: true
  order: 7
  stageTransition:
    name: slide
</route>
