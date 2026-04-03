import type {
  AssistantDeltaEvent,
  AssistantFinalEvent,
  BridgeContentPart,
  BridgeMessage,
  DoneEvent,
  ErrorEvent,
  FileUploadRequest,
  FileUploadResponse,
  LobsterBridgeEvent,
  LobsterSkill,
  PermissionRequestEvent,
  PermissionRespondRequest,
  ReasoningDeltaEvent,
  ReasoningFinalEvent,
  SessionBindRequest,
  SessionBindResponse,
  SkillConfirmInstallRequest,
  SkillDownloadRequest,
  SkillDownloadResponse,
  StateChangedEvent,
  StreamLobsterBridgeOptions,
  ToolCallEvent,
  ToolResultEvent,
} from '../types/lobster-bridge'

import { LobsterBridgeError } from '../types/lobster-bridge'

// ==================== Constants ====================

const DEFAULT_BASE_URL = 'http://127.0.0.1:19888'
const DEFAULT_API_KEY = 'lobsterai-agent-default-key'
const OLLAMA_PORTS = ['11434']

// ==================== Utility Functions ====================

/**
 * Normalize a Lobster base URL: trim, remove trailing slash, redirect common Ollama ports.
 */
export function normalizeBaseUrl(url: string | undefined): string {
  const configured = typeof url === 'string' ? url.trim() : ''
  const baseUrl = configured || DEFAULT_BASE_URL

  // NOTICE: Redirect common Ollama ports to prevent accidental misconfiguration
  for (const port of OLLAMA_PORTS) {
    if (baseUrl.includes(`:${port}`)) {
      return DEFAULT_BASE_URL
    }
  }

  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
}

/**
 * Normalize a Lobster API key, falling back to the default.
 */
export function normalizeApiKey(key: string | undefined): string {
  const configured = typeof key === 'string' ? key.trim() : ''
  return configured || DEFAULT_API_KEY
}

/**
 * Build standard auth headers for Lobster API requests.
 */
export function buildAuthHeaders(apiKey: string): HeadersInit {
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
}

// ==================== Session Management ====================

/**
 * Bind an AIRI session to a Lobster runtime session.
 * POST /api/agent/bridge/bind
 */
export async function bindSession(
  baseUrl: string,
  apiKey: string,
  airiSessionId: string,
): Promise<SessionBindResponse> {
  const body: SessionBindRequest = { airiSessionId }
  const response = await fetch(`${baseUrl}/api/agent/bridge/bind`, {
    method: 'POST',
    headers: buildAuthHeaders(apiKey),
    body: JSON.stringify(body),
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new LobsterBridgeError(
      String(data?.error || data?.message || `bind session error (${response.status})`),
      data?.code,
      response.status,
    )
  }
  return data as SessionBindResponse
}

// ==================== File Upload ====================

/**
 * Upload file attachments to the Lobster server and return file IDs.
 * POST /api/agent/files/upload (called once per file)
 *
 * Note: Image attachments are NOT uploaded here -- they are inlined into
 * message content as base64 data URLs. Only non-image files go through this.
 */
export async function uploadFiles(
  baseUrl: string,
  apiKey: string,
  airiSessionId: string,
  fileAttachments: Array<{ type: 'file', data: string, mimeType: string, name: string }>,
): Promise<string[]> {
  const uploaded: string[] = []
  for (const attachment of fileAttachments) {
    const body: FileUploadRequest = {
      airiSessionId,
      name: attachment.name,
      mimeType: attachment.mimeType,
      base64Data: attachment.data,
    }
    const response = await fetch(`${baseUrl}/api/agent/files/upload`, {
      method: 'POST',
      headers: buildAuthHeaders(apiKey),
      body: JSON.stringify(body),
    })
    const data = await response.json().catch(() => null) as FileUploadResponse | null
    if (!response.ok) {
      throw new LobsterBridgeError(
        String(data?.file?.name ? `${data.file.name} upload failed` : `file upload error (${response.status})`),
        undefined,
        response.status,
      )
    }
    const fileId = data?.file?.id
    if (fileId) {
      uploaded.push(fileId)
    }
  }
  return uploaded
}

// ==================== Content Building ====================

/**
 * Build user message content. Returns a plain string if no images,
 * otherwise returns a multipart array with text and image_url parts.
 */
export function buildUserContent(
  text: string,
  imageAttachments: Array<{ data: string, mimeType: string }>,
): string | BridgeContentPart[] {
  if (imageAttachments.length === 0) {
    return text
  }
  const parts: BridgeContentPart[] = [{ type: 'text', text }]
  for (const attachment of imageAttachments) {
    parts.push({
      type: 'image_url',
      image_url: {
        url: `data:${attachment.mimeType};base64,${attachment.data}`,
      },
    })
  }
  return parts
}

/**
 * Build the full message history for a bridge chat request.
 * Converts existing session messages into BridgeMessage format.
 */
export function buildBridgeMessages(
  userContent: string | BridgeContentPart[],
  existingMessages?: Array<{ role: string, content: unknown }>,
): BridgeMessage[] {
  const messages: BridgeMessage[] = []

  if (existingMessages) {
    for (const msg of existingMessages) {
      messages.push({
        role: msg.role as BridgeMessage['role'],
        content: typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content as BridgeContentPart[]
            : '',
      })
    }
  }

  messages.push({
    role: 'user',
    content: userContent,
  })

  return messages
}

// ==================== Core: Streaming Chat ====================

/**
 * Stream a chat response from the Lobster Bridge as an AsyncIterable of events.
 *
 * This is the core function. It POSTs to /api/agent/bridge/chat and yields
 * structured LobsterBridgeEvent objects as they arrive via SSE.
 *
 * Side-effect events (state.changed, permission.request) are dispatched via
 * callbacks rather than yielded, so the caller can handle them separately
 * from the main message-building flow.
 *
 * Usage:
 *   for await (const event of streamChat({ ... })) {
 *     switch (event.type) {
 *       case 'assistant.delta': ...
 *       case 'tool.call': ...
 *     }
 *   }
 */
export async function* streamChat(
  options: StreamLobsterBridgeOptions,
): AsyncIterable<LobsterBridgeEvent> {
  const { baseUrl, apiKey, request, signal, onStateChange, onPermissionRequest } = options

  const response = await fetch(`${baseUrl}/api/agent/bridge/chat`, {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(apiKey),
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(request),
    signal,
  })

  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new LobsterBridgeError(
      String(data?.error || data?.message || `bridge chat error (${response.status})`),
      data?.code,
      response.status,
    )
  }

  if (!response.body) {
    throw new LobsterBridgeError('Lobster API returned empty stream body')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) {
        break
      }
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line.startsWith('data:')) {
          continue
        }
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') {
          continue
        }

        let json: Record<string, unknown>
        try {
          json = JSON.parse(payload)
        }
        catch {
          continue
        }

        const eventType = json.type as string
        const normalizedEvent = (() => {
          switch (eventType) {
            case 'state.changed':
              return {
                ...json,
                payload: {
                  state: (json as any).payload?.state ?? json.state,
                  emotion: (json as any).payload?.emotion ?? json.emotion,
                  meta: (json as any).payload?.meta ?? json.meta,
                },
              }
            case 'permission.request':
              return {
                ...json,
                payload: {
                  requestId: (json as any).payload?.requestId ?? json.requestId,
                  capabilityToken: (json as any).payload?.capabilityToken ?? json.capabilityToken,
                  toolName: (json as any).payload?.toolName ?? json.toolName,
                  toolInput: (json as any).payload?.toolInput ?? json.toolInput,
                  expiresAt: (json as any).payload?.expiresAt ?? json.expiresAt,
                },
              }
            case 'assistant.delta':
              return {
                ...json,
                payload: {
                  delta: (json as any).payload?.delta ?? json.text ?? '',
                },
              }
            case 'assistant.final':
              return {
                ...json,
                payload: {
                  content: (json as any).payload?.content ?? json.text ?? '',
                },
              }
            case 'reasoning.delta':
              return {
                ...json,
                payload: {
                  delta: (json as any).payload?.delta ?? json.text ?? '',
                },
              }
            case 'reasoning.final':
              return {
                ...json,
                payload: {
                  content: (json as any).payload?.content ?? json.text ?? '',
                },
              }
            case 'tool.call':
              return {
                ...json,
                payload: {
                  id: (json as any).payload?.id ?? json.toolCallId,
                  name: (json as any).payload?.name ?? json.name,
                  input: (json as any).payload?.input ?? json.arguments,
                },
              }
            case 'tool.result':
              return {
                ...json,
                payload: {
                  id: (json as any).payload?.id ?? json.toolCallId,
                  result: (json as any).payload?.result ?? json.result,
                  isError: (json as any).payload?.isError ?? json.isError,
                },
              }
            case 'error':
              return {
                ...json,
                payload: {
                  message: (json as any).payload?.message ?? json.message ?? 'Lobster Bridge error',
                  code: (json as any).payload?.code ?? json.code,
                },
              }
            default:
              return json
          }
        })()

        // Dispatch side-effect events via callbacks
        if (eventType === 'state.changed' && onStateChange) {
          onStateChange((normalizedEvent as unknown as StateChangedEvent).payload.state)
          continue
        }
        if (eventType === 'permission.request' && onPermissionRequest) {
          onPermissionRequest((normalizedEvent as unknown as PermissionRequestEvent).payload)
          continue
        }

        // Yield all other events for the caller to process
        switch (eventType) {
          case 'assistant.delta':
            yield normalizedEvent as unknown as AssistantDeltaEvent
            break
          case 'assistant.final':
            yield normalizedEvent as unknown as AssistantFinalEvent
            break
          case 'reasoning.delta':
            yield normalizedEvent as unknown as ReasoningDeltaEvent
            break
          case 'reasoning.final':
            yield normalizedEvent as unknown as ReasoningFinalEvent
            break
          case 'tool.call':
            yield normalizedEvent as unknown as ToolCallEvent
            break
          case 'tool.result':
            yield normalizedEvent as unknown as ToolResultEvent
            break
          case 'done':
            yield normalizedEvent as unknown as DoneEvent
            return
          case 'error': {
            const errorEvent = normalizedEvent as unknown as ErrorEvent
            throw new LobsterBridgeError(
              errorEvent.payload?.message ?? 'Lobster Bridge error',
              errorEvent.payload?.code,
            )
          }
          case 'session.bound':
          case 'state.changed':
          case 'permission.request':
            // Already handled via callbacks above, or no action needed
            break
          default:
            // Unknown event type -- yield as-is for forward compatibility
            yield normalizedEvent as unknown as LobsterBridgeEvent
        }
      }
    }
  }
  finally {
    reader.releaseLock()
  }
}

// ==================== Permission Management ====================

/**
 * Respond to a permission request (allow or deny).
 * POST /api/agent/bridge/permission
 */
export async function respondPermission(
  baseUrl: string,
  apiKey: string,
  airiSessionId: string,
  requestId: string,
  capabilityToken: string,
  decision: 'allow' | 'deny',
): Promise<void> {
  const body: PermissionRespondRequest = {
    airiSessionId,
    requestId,
    capabilityToken,
    decision,
  }
  const response = await fetch(`${baseUrl}/api/agent/bridge/permission`, {
    method: 'POST',
    headers: buildAuthHeaders(apiKey),
    body: JSON.stringify(body),
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new LobsterBridgeError(
      String(data?.error || data?.message || `permission respond error (${response.status})`),
      data?.code,
      response.status,
    )
  }
}

/**
 * List all pending permission requests for a session.
 * POST /api/agent/bridge/permission/list
 */
export async function listPendingPermissions(
  baseUrl: string,
  apiKey: string,
  airiSessionId: string,
): Promise<PermissionRequestEvent['payload'][]> {
  const response = await fetch(`${baseUrl}/api/agent/bridge/permission/list`, {
    method: 'POST',
    headers: buildAuthHeaders(apiKey),
    body: JSON.stringify({ airiSessionId }),
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new LobsterBridgeError(
      String(data?.error || data?.message || `list permissions error (${response.status})`),
      data?.code,
      response.status,
    )
  }
  return Array.isArray(data?.permissions) ? data.permissions : []
}

// ==================== Skill Management ====================

/**
 * List all available skills.
 * GET /api/agent/skills
 */
export async function listSkills(
  baseUrl: string,
  apiKey: string,
): Promise<LobsterSkill[]> {
  const response = await fetch(`${baseUrl}/api/agent/skills`, {
    headers: buildAuthHeaders(apiKey),
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new LobsterBridgeError(
      String(data?.error || data?.message || `list skills error (${response.status})`),
      data?.code,
      response.status,
    )
  }

  const rawSkills = Array.isArray(data?.skills) ? data.skills : []
  return rawSkills.map((skill: any, index: number) => normalizeSkill(skill, index)).filter(Boolean) as LobsterSkill[]
}

/**
 * Toggle a skill's enabled state.
 * POST /api/agent/skills/set-enabled
 */
export async function setSkillEnabled(
  baseUrl: string,
  apiKey: string,
  skillId: string,
  enabled: boolean,
): Promise<LobsterSkill[]> {
  const response = await fetch(`${baseUrl}/api/agent/skills/set-enabled`, {
    method: 'POST',
    headers: buildAuthHeaders(apiKey),
    body: JSON.stringify({ id: skillId, enabled }),
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new LobsterBridgeError(
      String(data?.error || data?.message || `set skill enabled error (${response.status})`),
      data?.code,
      response.status,
    )
  }

  const rawSkills = Array.isArray(data?.skills) ? data.skills : []
  return rawSkills.map((skill: any, index: number) => normalizeSkill(skill, index)).filter(Boolean) as LobsterSkill[]
}

/**
 * Get a skill's configuration.
 * POST /api/agent/skills/get-config
 */
export async function getSkillConfig(
  baseUrl: string,
  apiKey: string,
  skillId: string,
): Promise<Record<string, string>> {
  const response = await fetch(`${baseUrl}/api/agent/skills/get-config`, {
    method: 'POST',
    headers: buildAuthHeaders(apiKey),
    body: JSON.stringify({ id: skillId }),
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new LobsterBridgeError(
      String(data?.error || data?.message || `get skill config error (${response.status})`),
      data?.code,
      response.status,
    )
  }
  return data?.config ?? {}
}

/**
 * Save a skill's configuration.
 * POST /api/agent/skills/set-config
 */
export async function setSkillConfig(
  baseUrl: string,
  apiKey: string,
  skillId: string,
  config: Record<string, string>,
): Promise<void> {
  const response = await fetch(`${baseUrl}/api/agent/skills/set-config`, {
    method: 'POST',
    headers: buildAuthHeaders(apiKey),
    body: JSON.stringify({ id: skillId, config }),
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new LobsterBridgeError(
      String(data?.error || data?.message || `set skill config error (${response.status})`),
      data?.code,
      response.status,
    )
  }
}

/**
 * Download a skill from a source (Git URL, local path, or archive).
 * POST /api/agent/skills/download
 */
export async function downloadSkill(
  baseUrl: string,
  apiKey: string,
  source: string,
): Promise<SkillDownloadResponse> {
  const body: SkillDownloadRequest = { source }
  const response = await fetch(`${baseUrl}/api/agent/skills/download`, {
    method: 'POST',
    headers: buildAuthHeaders(apiKey),
    body: JSON.stringify(body),
  })

  const data = await response.json().catch(() => null) as SkillDownloadResponse | null
  if (!response.ok) {
    throw new LobsterBridgeError(
      String(data ? JSON.stringify(data) : `download skill error (${response.status})`),
      undefined,
      response.status,
    )
  }
  return data ?? { success: false }
}

/**
 * Confirm or cancel a pending skill installation.
 * POST /api/agent/skills/confirm-install
 */
export async function confirmSkillInstall(
  baseUrl: string,
  apiKey: string,
  pendingInstallId: string,
  action: 'install' | 'installDisabled' | 'cancel',
): Promise<void> {
  const body: SkillConfirmInstallRequest = { pendingInstallId, action }
  const response = await fetch(`${baseUrl}/api/agent/skills/confirm-install`, {
    method: 'POST',
    headers: buildAuthHeaders(apiKey),
    body: JSON.stringify(body),
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new LobsterBridgeError(
      String(data?.error || data?.message || `confirm install error (${response.status})`),
      data?.code,
      response.status,
    )
  }
}

// ==================== Internal Helpers ====================

/**
 * Normalize a raw skill object from the API into a LobsterSkill.
 */
function normalizeSkill(skill: unknown, index: number): LobsterSkill | null {
  const rawId = (skill as any)?.id ?? (skill as any)?.name ?? `lobster-skill-${index}`
  const id = String(rawId ?? '').trim()
  if (!id) {
    return null
  }

  const rawName = (skill as any)?.name ?? (skill as any)?.id ?? id
  const name = String(rawName ?? '').trim() || id
  const description = typeof (skill as any)?.description === 'string'
    ? (skill as any).description
    : ''

  return {
    id,
    name,
    enabled: Boolean((skill as any)?.enabled),
    description,
    isBuiltIn: Boolean((skill as any)?.isBuiltIn ?? (skill as any)?.builtIn),
  }
}
