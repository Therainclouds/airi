import { env } from 'node:process'

import { createOpenRouter } from '@xsai-ext/providers/create'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'

import { attemptForToolsCompatibilityDiscovery, useLLM } from './llm'

const streamTextMock = vi.hoisted(() => vi.fn(async (options: any) => {
  await Promise.resolve()
  await options.onEvent?.({ type: 'finish' })
}))

vi.mock('@xsai/stream-text', () => ({
  streamText: streamTextMock,
}))

vi.mock('../tools', () => ({
  debug: vi.fn(async () => []),
  mcp: vi.fn(async () => []),
}))

function doesHaveOpenRouterApiKey() {
  const apiKey = env.LLM_API_OPENROUTER_API_KEY
  if (!apiKey) {
    console.warn('Skipping llm store tests, because LLM_API_OPENROUTER_API_KEY is not set')
  }

  return !!apiKey
}

const hasOpenRouterApiKey = doesHaveOpenRouterApiKey()

describe('useLLM', () => {
  it('should dedupe concurrent tools compatibility discovery for the same provider and model', async () => {
    setActivePinia(createPinia())
    streamTextMock.mockClear()

    const store = useLLM()
    const chatProvider = {
      chat: () => ({
        apiKey: 'test-key',
        baseURL: 'http://127.0.0.1:19888/',
      }),
    }

    await Promise.all([
      store.discoverToolsCompatibility('claude-agent', chatProvider as any, []),
      store.discoverToolsCompatibility('claude-agent', chatProvider as any, []),
    ])

    expect(streamTextMock).toHaveBeenCalledTimes(2)

    await store.discoverToolsCompatibility('claude-agent', chatProvider as any, [])

    expect(streamTextMock).toHaveBeenCalledTimes(2)
  })
})

describe.skipIf(!hasOpenRouterApiKey)('llm store', { timeout: 60000 }, async () => {
  it('should be false for phi-4', async () => {
    // TODO: base url should not be hardcoded, wait for https://github.com/moeru-ai/xsai/pull/194
    const res1 = await attemptForToolsCompatibilityDiscovery('microsoft/phi-4', createOpenRouter(env.LLM_API_OPENROUTER_API_KEY!, 'https://openrouter.ai/api/v1/'), [])
    expect(res1).toBe(false)
  })

  it('should be false for gpt-4o-mini', async () => {
    // TODO: base url should not be hardcoded, wait for https://github.com/moeru-ai/xsai/pull/194
    const res1 = await attemptForToolsCompatibilityDiscovery('openai/gpt-4o-mini', createOpenRouter(env.LLM_API_OPENROUTER_API_KEY!, 'https://openrouter.ai/api/v1/'), [])
    expect(res1).toBe(false)
  })

  it('should be true for gpt-4o', async () => {
    // TODO: base url should not be hardcoded, wait for https://github.com/moeru-ai/xsai/pull/194
    const res2 = await attemptForToolsCompatibilityDiscovery('openai/gpt-4o', createOpenRouter(env.LLM_API_OPENROUTER_API_KEY!, 'https://openrouter.ai/api/v1/'), [])
    expect(res2).toBe(true)
  })
})
