import type { LobsterSkill as LobsterSkillType } from '../types/lobster-bridge'

import { computed, ref } from 'vue'

import {
  confirmSkillInstall,
  downloadSkill,
  getSkillConfig,
  listSkills,
  normalizeApiKey,
  normalizeBaseUrl,
  setSkillConfig,
  setSkillEnabled,
} from '../services/lobster-bridge'
import { useProvidersStore } from '../stores/providers'

export interface LobsterSkill {
  id: string
  name: string
  enabled: boolean
  description?: string
  isBuiltIn?: boolean
}

const lobsterSkills = ref<LobsterSkill[]>([])
const lobsterSkillsLoading = ref(false)

export function useLobsterSkills() {
  const providersStore = useProvidersStore()

  const providerConfig = computed(() => (providersStore.getProviderConfig('lobster-agent') as Record<string, any>) ?? {})
  const baseUrl = computed(() => normalizeBaseUrl(providerConfig.value?.baseUrl))
  const apiKey = computed(() => normalizeApiKey(providerConfig.value?.apiKey))
  const totalSkillsCount = computed(() => lobsterSkills.value.length)
  const enabledSkillsCount = computed(() => lobsterSkills.value.filter(skill => skill.enabled).length)

  async function requestLobster(path: string, init?: { method?: string, body?: Record<string, unknown> }) {
    const response = await fetch(`${baseUrl.value}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey.value}`,
        'Content-Type': 'application/json',
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    })
    const data = await response.json().catch(() => null)
    if (!response.ok)
      throw new Error(String(data?.error || data?.message || `${path} error (${response.status})`))
    return data
  }

  function replaceSkills(nextSkills: LobsterSkillType[]) {
    lobsterSkills.value = nextSkills.map(skill => ({
      id: skill.id,
      name: skill.name,
      enabled: skill.enabled,
      description: skill.description,
      isBuiltIn: skill.isBuiltIn,
    }))
  }

  async function refreshSkills() {
    lobsterSkillsLoading.value = true
    try {
      const skills = await listSkills(baseUrl.value, apiKey.value)
      replaceSkills(skills)
      return lobsterSkills.value
    }
    finally {
      lobsterSkillsLoading.value = false
    }
  }

  async function setSkillEnabledFn(id: string, enabled: boolean) {
    const skills = await setSkillEnabled(baseUrl.value, apiKey.value, id, enabled)
    replaceSkills(skills)
    return lobsterSkills.value
  }

  async function getSkillConfigFn(id: string) {
    return await getSkillConfig(baseUrl.value, apiKey.value, id)
  }

  async function setSkillConfigFn(id: string, config: Record<string, string>) {
    await setSkillConfig(baseUrl.value, apiKey.value, id, config)
  }

  async function downloadSkillFn(source: string) {
    return await downloadSkill(baseUrl.value, apiKey.value, source)
  }

  async function confirmInstallFn(pendingInstallId: string, action: 'install' | 'installDisabled' | 'cancel') {
    await confirmSkillInstall(baseUrl.value, apiKey.value, pendingInstallId, action)
  }

  return {
    skills: lobsterSkills,
    loading: lobsterSkillsLoading,
    totalSkillsCount,
    enabledSkillsCount,
    baseUrl,
    apiKey,
    providerConfig,
    requestLobster,
    refreshSkills,
    setSkillEnabled: setSkillEnabledFn,
    getSkillConfig: getSkillConfigFn,
    setSkillConfig: setSkillConfigFn,
    downloadSkill: downloadSkillFn,
    confirmInstall: confirmInstallFn,
  }
}
