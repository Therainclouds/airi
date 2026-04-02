export interface ChatBridgeModeOptions {
  useBridge?: boolean
}

export function shouldAttemptBridge(bridgeOptions?: ChatBridgeModeOptions | null): boolean {
  return Boolean(bridgeOptions) && bridgeOptions?.useBridge !== false
}

export function shouldUseStandardLlmStream(bridgeOptions?: ChatBridgeModeOptions | null, bridgeFailed = false): boolean {
  return !bridgeOptions || bridgeOptions.useBridge === false || bridgeFailed
}
