import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useLobsterBridgeSessionStore } from './lobster-bridge-session'

describe('lobster bridge session store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('stores selected skills per session', () => {
    const store = useLobsterBridgeSessionStore()

    store.setSelectedSkillIds('session-a', ['skill-1', 'skill-2'])
    store.setSelectedSkillIds('session-b', ['skill-3'])

    expect(store.getSelectedSkillIds('session-a')).toEqual(['skill-1', 'skill-2'])
    expect(store.getSelectedSkillIds('session-b')).toEqual(['skill-3'])
  })

  it('upserts and removes pending permissions per session', () => {
    const store = useLobsterBridgeSessionStore()

    store.upsertPendingPermission('session-a', {
      requestId: 'request-1',
      capabilityToken: 'token-1',
      toolName: 'AskUserQuestion',
      toolInput: { question: '允许吗？' },
    })

    store.upsertPendingPermission('session-a', {
      requestId: 'request-1',
      capabilityToken: 'token-1',
      toolName: 'AskUserQuestion',
      toolInput: { question: '允许吗？', updated: true },
    })

    expect(store.getPendingPermissions('session-a')).toEqual([
      {
        requestId: 'request-1',
        capabilityToken: 'token-1',
        toolName: 'AskUserQuestion',
        toolInput: { question: '允许吗？', updated: true },
      },
    ])

    store.removePendingPermission('session-a', 'request-1')

    expect(store.getPendingPermissions('session-a')).toEqual([])
  })
})
