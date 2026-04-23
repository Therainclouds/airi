import type { ChatProvider as XsaiChatProvider } from '@xsai-ext/providers/utils'

import { createOpenAI } from '@xsai-ext/providers/create'
import { z } from 'zod'

import { createOpenAICompatibleValidators } from '../../validators/openai-compatible'
import { defineProvider } from '../registry'

const openClawAgentConfigSchema = z.object({
  apiKey: z
    .string('API Key')
    .optional()
    .default('lobsterai-agent-default-key'),
  baseUrl: z
    .string('Base URL')
    .optional()
    .default('http://127.0.0.1:19888'),
  useBridge: z
    .boolean('Use Bridge Protocol')
    .optional()
    .default(true),
})

type OpenClawAgentConfig = z.input<typeof openClawAgentConfigSchema>

function normalizeApiKey(apiKey?: string): string {
  const value = apiKey?.trim()
  if (!value) {
    return 'lobsterai-agent-default-key'
  }
  return value
}

function normalizeBaseUrl(baseUrl?: string): string {
  const value = baseUrl?.trim()
  if (!value) {
    return 'http://127.0.0.1:19888'
  }
  if (value.includes('://localhost:11434') || value.includes('://127.0.0.1:11434')) {
    return 'http://127.0.0.1:19888'
  }
  return value
}

function createOpenClawAgentProvider(config: OpenClawAgentConfig): XsaiChatProvider {
  return createOpenAI(normalizeApiKey(config.apiKey as string), normalizeBaseUrl(config.baseUrl as string))
}

function normalizeValidationConfig(config: any) {
  return {
    ...config,
    apiKey: normalizeApiKey(config?.apiKey as string),
    baseUrl: normalizeBaseUrl(config?.baseUrl as string),
  }
}

const baseValidators = createOpenAICompatibleValidators({
  checks: ['connectivity', 'chat_completions'],
}) ?? {}

const openClawAgentValidators = {
  validateConfig: (baseValidators.validateConfig ?? []).map(factory => (ctx: any) => {
    const rule = factory(ctx)
    return {
      ...rule,
      validator: async (config: any, contextOptions: any) =>
        rule.validator(normalizeValidationConfig(config), contextOptions),
    }
  }),
  validateProvider: (baseValidators.validateProvider ?? []).map(factory => (ctx: any) => {
    const rule = factory(ctx)
    return {
      ...rule,
      validator: async (config: any, provider: any, providerExtra: any, contextOptions: any) => {
        return rule.validator(normalizeValidationConfig(config), provider, providerExtra, contextOptions)
      },
    }
  }),
}

export const providerOpenClawAgent = defineProvider<OpenClawAgentConfig>({
  id: 'openclaw-agent',
  order: 1,
  name: 'OpenClaw Agent',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.openclaw-agent.title'),
  description: 'OpenClaw bridge endpoint for desktop-capable agent chat',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.openclaw-agent.description'),
  tasks: ['chat', 'agent'],
  icon: 'i-lucide:bot',

  createProviderConfig: ({ t }) => openClawAgentConfigSchema.extend({
    apiKey: openClawAgentConfigSchema.shape.apiKey.meta({
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.label'),
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.description'),
      placeholderLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.placeholder'),
      type: 'password',
    }),
    baseUrl: openClawAgentConfigSchema.shape.baseUrl.meta({
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.label'),
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.description'),
      placeholderLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.placeholder'),
    }),
    useBridge: openClawAgentConfigSchema.shape.useBridge.meta({
      labelLocalized: 'Use Bridge Protocol',
      descriptionLocalized: 'Enable the structured OpenClaw bridge protocol (events, tools, permissions). Disable to fall back to OpenAI-compatible text mode.',
      type: 'boolean',
    }),
  }),

  createProvider(config) {
    return createOpenClawAgentProvider({
      apiKey: normalizeApiKey(config.apiKey as string),
      baseUrl: normalizeBaseUrl(config.baseUrl as string),
    })
  },

  validationRequiredWhen(_config) {
    return true
  },

  validators: {
    ...openClawAgentValidators,
  },
})
