import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

interface PendingPermissionItem {
  requestId: string
  capabilityToken: string
  toolName: string
  toolInput: Record<string, unknown>
  turnId?: string
  createdAt?: number
  expiresAt?: number
}

export const useLobsterBridgeSessionStore = defineStore('lobster-bridge-session', () => {
  const selectedSkillIdsBySession = ref<Record<string, string[]>>({})
  const pendingPermissionsBySession = ref<Record<string, PendingPermissionItem[]>>({})

  function getSelectedSkillIds(sessionId?: string) {
    return sessionId ? (selectedSkillIdsBySession.value[sessionId] ?? []) : []
  }

  function setSelectedSkillIds(sessionId: string | undefined, skillIds: string[]) {
    if (!sessionId)
      return
    selectedSkillIdsBySession.value = {
      ...selectedSkillIdsBySession.value,
      [sessionId]: [...skillIds],
    }
  }

  function filterSelectedSkillIds(sessionId: string | undefined, availableIds: Set<string>) {
    if (!sessionId)
      return
    setSelectedSkillIds(sessionId, getSelectedSkillIds(sessionId).filter(id => availableIds.has(id)))
  }

  function getPendingPermissions(sessionId?: string) {
    return sessionId ? (pendingPermissionsBySession.value[sessionId] ?? []) : []
  }

  function replacePendingPermissions(sessionId: string | undefined, permissions: PendingPermissionItem[]) {
    if (!sessionId)
      return
    pendingPermissionsBySession.value = {
      ...pendingPermissionsBySession.value,
      [sessionId]: permissions,
    }
  }

  function upsertPendingPermission(sessionId: string | undefined, permission: PendingPermissionItem) {
    if (!sessionId)
      return
    const existing = getPendingPermissions(sessionId)
    const index = existing.findIndex(item => item.requestId === permission.requestId)
    const next = index === -1
      ? [...existing, permission]
      : existing.map((item, itemIndex) => itemIndex === index ? permission : item)
    replacePendingPermissions(sessionId, next)
  }

  function removePendingPermission(sessionId: string | undefined, requestId: string) {
    if (!sessionId)
      return
    replacePendingPermissions(sessionId, getPendingPermissions(sessionId).filter(item => item.requestId !== requestId))
  }

  function clearSessionState(sessionId: string | undefined) {
    if (!sessionId)
      return
    const { [sessionId]: _skills, ...restSkills } = selectedSkillIdsBySession.value
    const { [sessionId]: _permissions, ...restPermissions } = pendingPermissionsBySession.value
    selectedSkillIdsBySession.value = restSkills
    pendingPermissionsBySession.value = restPermissions
  }

  return {
    selectedSkillIdsBySession: computed(() => selectedSkillIdsBySession.value),
    pendingPermissionsBySession: computed(() => pendingPermissionsBySession.value),
    getSelectedSkillIds,
    setSelectedSkillIds,
    filterSelectedSkillIds,
    getPendingPermissions,
    replacePendingPermissions,
    upsertPendingPermission,
    removePendingPermission,
    clearSessionState,
  }
})
