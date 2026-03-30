import type { ToolMessage } from '@xsai/shared-chat'

import type { ChatStreamEventContext, StreamingAssistantMessage } from '../../types/chat'

export interface BridgeStateChangedHookEvent {
  state: string
  emotion: string
  toolName?: string
  reason?: string
}

export interface BridgePermissionRequestHookEvent {
  requestId: string
  toolName: string
  toolInput: Record<string, unknown>
}

export interface ChatHookRegistry {
  onBeforeMessageComposed: (cb: (message: string, context: Omit<ChatStreamEventContext, 'composedMessage'>) => Promise<void>) => () => void
  onAfterMessageComposed: (cb: (message: string, context: ChatStreamEventContext) => Promise<void>) => () => void
  onBeforeSend: (cb: (message: string, context: ChatStreamEventContext) => Promise<void>) => () => void
  onAfterSend: (cb: (message: string, context: ChatStreamEventContext) => Promise<void>) => () => void
  onTokenLiteral: (cb: (literal: string, context: ChatStreamEventContext) => Promise<void>) => () => void
  onTokenSpecial: (cb: (special: string, context: ChatStreamEventContext) => Promise<void>) => () => void
  onStreamEnd: (cb: (context: ChatStreamEventContext) => Promise<void>) => () => void
  onAssistantResponseEnd: (cb: (message: string, context: ChatStreamEventContext) => Promise<void>) => () => void
  onAssistantMessage: (cb: (message: StreamingAssistantMessage, messageText: string, context: ChatStreamEventContext) => Promise<void>) => () => void
  onChatTurnComplete: (cb: (chat: { output: StreamingAssistantMessage, outputText: string, toolCalls: ToolMessage[] }, context: ChatStreamEventContext) => Promise<void>) => () => void
  onBridgeStateChanged: (cb: (event: BridgeStateChangedHookEvent, context: ChatStreamEventContext) => Promise<void>) => () => void
  onBridgePermissionRequest: (cb: (event: BridgePermissionRequestHookEvent, context: ChatStreamEventContext) => Promise<void>) => () => void
  emitBeforeMessageComposedHooks: (message: string, context: Omit<ChatStreamEventContext, 'composedMessage'>) => Promise<void>
  emitAfterMessageComposedHooks: (message: string, context: ChatStreamEventContext) => Promise<void>
  emitBeforeSendHooks: (message: string, context: ChatStreamEventContext) => Promise<void>
  emitAfterSendHooks: (message: string, context: ChatStreamEventContext) => Promise<void>
  emitTokenLiteralHooks: (literal: string, context: ChatStreamEventContext) => Promise<void>
  emitTokenSpecialHooks: (special: string, context: ChatStreamEventContext) => Promise<void>
  emitStreamEndHooks: (context: ChatStreamEventContext) => Promise<void>
  emitAssistantResponseEndHooks: (message: string, context: ChatStreamEventContext) => Promise<void>
  emitAssistantMessageHooks: (message: StreamingAssistantMessage, messageText: string, context: ChatStreamEventContext) => Promise<void>
  emitChatTurnCompleteHooks: (chat: { output: StreamingAssistantMessage, outputText: string, toolCalls: ToolMessage[] }, context: ChatStreamEventContext) => Promise<void>
  emitBridgeStateChangedHooks: (event: BridgeStateChangedHookEvent, context: ChatStreamEventContext) => Promise<void>
  emitBridgePermissionRequestHooks: (event: BridgePermissionRequestHookEvent, context: ChatStreamEventContext) => Promise<void>
  clearHooks: () => void
}

export function createChatHooks(): ChatHookRegistry {
  const onBeforeMessageComposedHooks: Array<(message: string, context: Omit<ChatStreamEventContext, 'composedMessage'>) => Promise<void>> = []
  const onAfterMessageComposedHooks: Array<(message: string, context: ChatStreamEventContext) => Promise<void>> = []
  const onBeforeSendHooks: Array<(message: string, context: ChatStreamEventContext) => Promise<void>> = []
  const onAfterSendHooks: Array<(message: string, context: ChatStreamEventContext) => Promise<void>> = []
  const onTokenLiteralHooks: Array<(literal: string, context: ChatStreamEventContext) => Promise<void>> = []
  const onTokenSpecialHooks: Array<(special: string, context: ChatStreamEventContext) => Promise<void>> = []
  const onStreamEndHooks: Array<(context: ChatStreamEventContext) => Promise<void>> = []
  const onAssistantResponseEndHooks: Array<(message: string, context: ChatStreamEventContext) => Promise<void>> = []
  const onAssistantMessageHooks: Array<(message: StreamingAssistantMessage, messageText: string, context: ChatStreamEventContext) => Promise<void>> = []
  const onChatTurnCompleteHooks: Array<(chat: { output: StreamingAssistantMessage, outputText: string, toolCalls: ToolMessage[] }, context: ChatStreamEventContext) => Promise<void>> = []
  const onBridgeStateChangedHooks: Array<(event: BridgeStateChangedHookEvent, context: ChatStreamEventContext) => Promise<void>> = []
  const onBridgePermissionRequestHooks: Array<(event: BridgePermissionRequestHookEvent, context: ChatStreamEventContext) => Promise<void>> = []

  function onBeforeMessageComposed(cb: (message: string, context: Omit<ChatStreamEventContext, 'composedMessage'>) => Promise<void>) {
    onBeforeMessageComposedHooks.push(cb)
    return () => {
      const index = onBeforeMessageComposedHooks.indexOf(cb)
      if (index >= 0)
        onBeforeMessageComposedHooks.splice(index, 1)
    }
  }

  function onAfterMessageComposed(cb: (message: string, context: ChatStreamEventContext) => Promise<void>) {
    onAfterMessageComposedHooks.push(cb)
    return () => {
      const index = onAfterMessageComposedHooks.indexOf(cb)
      if (index >= 0)
        onAfterMessageComposedHooks.splice(index, 1)
    }
  }

  function onBeforeSend(cb: (message: string, context: ChatStreamEventContext) => Promise<void>) {
    onBeforeSendHooks.push(cb)
    return () => {
      const index = onBeforeSendHooks.indexOf(cb)
      if (index >= 0)
        onBeforeSendHooks.splice(index, 1)
    }
  }

  function onAfterSend(cb: (message: string, context: ChatStreamEventContext) => Promise<void>) {
    onAfterSendHooks.push(cb)
    return () => {
      const index = onAfterSendHooks.indexOf(cb)
      if (index >= 0)
        onAfterSendHooks.splice(index, 1)
    }
  }

  function onTokenLiteral(cb: (literal: string, context: ChatStreamEventContext) => Promise<void>) {
    onTokenLiteralHooks.push(cb)
    return () => {
      const index = onTokenLiteralHooks.indexOf(cb)
      if (index >= 0)
        onTokenLiteralHooks.splice(index, 1)
    }
  }

  function onTokenSpecial(cb: (special: string, context: ChatStreamEventContext) => Promise<void>) {
    onTokenSpecialHooks.push(cb)
    return () => {
      const index = onTokenSpecialHooks.indexOf(cb)
      if (index >= 0)
        onTokenSpecialHooks.splice(index, 1)
    }
  }

  function onStreamEnd(cb: (context: ChatStreamEventContext) => Promise<void>) {
    onStreamEndHooks.push(cb)
    return () => {
      const index = onStreamEndHooks.indexOf(cb)
      if (index >= 0)
        onStreamEndHooks.splice(index, 1)
    }
  }

  function onAssistantResponseEnd(cb: (message: string, context: ChatStreamEventContext) => Promise<void>) {
    onAssistantResponseEndHooks.push(cb)
    return () => {
      const index = onAssistantResponseEndHooks.indexOf(cb)
      if (index >= 0)
        onAssistantResponseEndHooks.splice(index, 1)
    }
  }

  function onAssistantMessage(cb: (message: StreamingAssistantMessage, messageText: string, context: ChatStreamEventContext) => Promise<void>) {
    onAssistantMessageHooks.push(cb)
    return () => {
      const index = onAssistantMessageHooks.indexOf(cb)
      if (index >= 0)
        onAssistantMessageHooks.splice(index, 1)
    }
  }

  function onChatTurnComplete(cb: (chat: { output: StreamingAssistantMessage, outputText: string, toolCalls: ToolMessage[] }, context: ChatStreamEventContext) => Promise<void>) {
    onChatTurnCompleteHooks.push(cb)
    return () => {
      const index = onChatTurnCompleteHooks.indexOf(cb)
      if (index >= 0)
        onChatTurnCompleteHooks.splice(index, 1)
    }
  }

  function onBridgeStateChanged(cb: (event: BridgeStateChangedHookEvent, context: ChatStreamEventContext) => Promise<void>) {
    onBridgeStateChangedHooks.push(cb)
    return () => {
      const index = onBridgeStateChangedHooks.indexOf(cb)
      if (index >= 0)
        onBridgeStateChangedHooks.splice(index, 1)
    }
  }

  function onBridgePermissionRequest(cb: (event: BridgePermissionRequestHookEvent, context: ChatStreamEventContext) => Promise<void>) {
    onBridgePermissionRequestHooks.push(cb)
    return () => {
      const index = onBridgePermissionRequestHooks.indexOf(cb)
      if (index >= 0)
        onBridgePermissionRequestHooks.splice(index, 1)
    }
  }

  function clearHooks() {
    onBeforeMessageComposedHooks.length = 0
    onAfterMessageComposedHooks.length = 0
    onBeforeSendHooks.length = 0
    onAfterSendHooks.length = 0
    onTokenLiteralHooks.length = 0
    onTokenSpecialHooks.length = 0
    onStreamEndHooks.length = 0
    onAssistantResponseEndHooks.length = 0
    onAssistantMessageHooks.length = 0
    onChatTurnCompleteHooks.length = 0
    onBridgeStateChangedHooks.length = 0
    onBridgePermissionRequestHooks.length = 0
  }

  async function runHookSafely(action: () => Promise<void>) {
    try {
      await action()
    }
    catch (error) {
      console.warn('[chat-hooks] hook execution failed:', error)
    }
  }

  async function emitBeforeMessageComposedHooks(message: string, context: Omit<ChatStreamEventContext, 'composedMessage'>) {
    for (const hook of onBeforeMessageComposedHooks)
      await runHookSafely(async () => await hook(message, context))
  }

  async function emitAfterMessageComposedHooks(message: string, context: ChatStreamEventContext) {
    for (const hook of onAfterMessageComposedHooks)
      await runHookSafely(async () => await hook(message, context))
  }

  async function emitBeforeSendHooks(message: string, context: ChatStreamEventContext) {
    for (const hook of onBeforeSendHooks)
      await runHookSafely(async () => await hook(message, context))
  }

  async function emitAfterSendHooks(message: string, context: ChatStreamEventContext) {
    for (const hook of onAfterSendHooks)
      await runHookSafely(async () => await hook(message, context))
  }

  async function emitTokenLiteralHooks(literal: string, context: ChatStreamEventContext) {
    for (const hook of onTokenLiteralHooks)
      await runHookSafely(async () => await hook(literal, context))
  }

  async function emitTokenSpecialHooks(special: string, context: ChatStreamEventContext) {
    for (const hook of onTokenSpecialHooks)
      await runHookSafely(async () => await hook(special, context))
  }

  async function emitStreamEndHooks(context: ChatStreamEventContext) {
    for (const hook of onStreamEndHooks)
      await runHookSafely(async () => await hook(context))
  }

  async function emitAssistantResponseEndHooks(message: string, context: ChatStreamEventContext) {
    for (const hook of onAssistantResponseEndHooks)
      await runHookSafely(async () => await hook(message, context))
  }

  async function emitAssistantMessageHooks(message: StreamingAssistantMessage, messageText: string, context: ChatStreamEventContext) {
    for (const hook of onAssistantMessageHooks)
      await runHookSafely(async () => await hook(message, messageText, context))
  }

  async function emitChatTurnCompleteHooks(chat: { output: StreamingAssistantMessage, outputText: string, toolCalls: ToolMessage[] }, context: ChatStreamEventContext) {
    for (const hook of onChatTurnCompleteHooks)
      await runHookSafely(async () => await hook(chat, context))
  }

  async function emitBridgeStateChangedHooks(event: BridgeStateChangedHookEvent, context: ChatStreamEventContext) {
    for (const hook of onBridgeStateChangedHooks)
      await runHookSafely(async () => await hook(event, context))
  }

  async function emitBridgePermissionRequestHooks(event: BridgePermissionRequestHookEvent, context: ChatStreamEventContext) {
    for (const hook of onBridgePermissionRequestHooks)
      await runHookSafely(async () => await hook(event, context))
  }

  return {
    onBeforeMessageComposed,
    onAfterMessageComposed,
    onBeforeSend,
    onAfterSend,
    onTokenLiteral,
    onTokenSpecial,
    onStreamEnd,
    onAssistantResponseEnd,
    onAssistantMessage,
    onChatTurnComplete,
    onBridgeStateChanged,
    onBridgePermissionRequest,
    emitBeforeMessageComposedHooks,
    emitAfterMessageComposedHooks,
    emitBeforeSendHooks,
    emitAfterSendHooks,
    emitTokenLiteralHooks,
    emitTokenSpecialHooks,
    emitStreamEndHooks,
    emitAssistantResponseEndHooks,
    emitAssistantMessageHooks,
    emitChatTurnCompleteHooks,
    emitBridgeStateChangedHooks,
    emitBridgePermissionRequestHooks,
    clearHooks,
  }
}
