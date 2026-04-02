import { describe, expect, it } from 'vitest'

import { shouldAttemptBridge, shouldUseStandardLlmStream } from './chat-bridge-mode'

describe('chat bridge mode', () => {
  it('attempts bridge when enabled or omitted', () => {
    expect(shouldAttemptBridge({ useBridge: true })).toBe(true)
    expect(shouldAttemptBridge({})).toBe(true)
  })

  it('skips bridge when disabled', () => {
    expect(shouldAttemptBridge({ useBridge: false })).toBe(false)
  })

  it('falls back to standard stream when bridge is disabled', () => {
    expect(shouldUseStandardLlmStream({ useBridge: false }, false)).toBe(true)
  })

  it('falls back to standard stream when bridge fails', () => {
    expect(shouldUseStandardLlmStream({ useBridge: true }, true)).toBe(true)
  })

  it('uses standard stream when bridge options are absent', () => {
    expect(shouldUseStandardLlmStream(undefined, false)).toBe(true)
  })
})
