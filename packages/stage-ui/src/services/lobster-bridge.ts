export interface LobsterBridgeImageAttachment {
  data: string
  mimeType: string
  type: 'image'
}

export interface LobsterBridgeFileAttachment {
  data: string
  mimeType: string
  name: string
  type: 'file'
}

export type LobsterBridgeEvent
  = | { type: 'session.bound', sessionId: string, turnId: string, lobsterSessionId: string }
    | { type: 'state.changed', sessionId: string, turnId: string, state: string, emotion: string, toolName?: string, reason?: string }
    | { type: 'assistant.delta' | 'assistant.final' | 'reasoning.delta' | 'reasoning.final', sessionId: string, turnId: string, text: string }
    | { type: 'tool.call', sessionId: string, turnId: string, toolCallId: string, name: string, arguments: string }
    | { type: 'tool.result', sessionId: string, turnId: string, toolCallId: string, result: string, isError?: boolean }
    | { type: 'permission.request', sessionId: string, turnId: string, requestId: string, toolName: string, toolInput: Record<string, unknown> }
    | { type: 'done', sessionId: string, turnId: string }
    | { type: 'error', sessionId: string, turnId: string, message: string }

export interface StreamLobsterBridgeOptions {
  airiSessionId: string
  text: string
  systemPrompt?: string
  model: string
  providerConfig: Record<string, any>
  imageAttachments?: LobsterBridgeImageAttachment[]
  fileAttachments?: LobsterBridgeFileAttachment[]
  skillIds?: string[]
  onEvent: (event: LobsterBridgeEvent) => Promise<void> | void
}

export interface LobsterSkillSummary {
  id: string
  name: string
  enabled: boolean
  description?: string
  version?: string
}

export interface LobsterSkillAuditReport {
  skillName: string
  riskLevel: string
  riskScore: number
  findings: Array<{
    severity: string
    dimension: string
    description: string
    file: string
    line?: number
  }>
}

function normalizeBaseUrl(providerConfig: Record<string, any>) {
  const configured = typeof providerConfig?.baseUrl === 'string' ? providerConfig.baseUrl.trim() : ''
  const baseUrl = configured || 'http://127.0.0.1:19888'
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
}

function normalizeApiKey(providerConfig: Record<string, any>) {
  const configured = String(providerConfig?.apiKey || '').trim()
  return configured || 'lobsterai-agent-default-key'
}

function buildUserContent(text: string, imageAttachments: LobsterBridgeImageAttachment[]) {
  if (imageAttachments.length === 0) {
    return text
  }
  const parts: Array<any> = [{ type: 'text', text }]
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

async function bindSession(baseUrl: string, apiKey: string, airiSessionId: string) {
  const response = await fetch(`${baseUrl}/api/agent/bridge/bind`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ airiSessionId }),
  })
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new Error(String(data?.error || `Bridge bind error (${response.status})`))
  }
}

async function uploadFiles(baseUrl: string, apiKey: string, airiSessionId: string, fileAttachments: LobsterBridgeFileAttachment[]) {
  const fileIds: string[] = []
  for (const attachment of fileAttachments) {
    const response = await fetch(`${baseUrl}/api/agent/files/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        airiSessionId,
        name: attachment.name,
        mimeType: attachment.mimeType,
        base64Data: attachment.data,
      }),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      throw new Error(String(data?.error || `File upload error (${response.status})`))
    }
    const fileId = String(data?.file?.id || '')
    if (fileId) {
      fileIds.push(fileId)
    }
  }
  return fileIds
}

export async function loadLobsterSkills(providerConfig: Record<string, any>) {
  const baseUrl = normalizeBaseUrl(providerConfig)
  const apiKey = normalizeApiKey(providerConfig)
  const response = await fetch(`${baseUrl}/api/agent/skills`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(String(data?.error || `Skills API error (${response.status})`))
  }
  const skills = Array.isArray(data?.skills) ? data.skills : []
  return skills.map((item: any) => ({
    id: String(item.id || ''),
    name: String(item.name || item.id || ''),
    enabled: !!item.enabled,
    description: typeof item.description === 'string' ? item.description : '',
    version: typeof item.version === 'string' ? item.version : '',
  })).filter((item: { id: string }) => !!item.id) as LobsterSkillSummary[]
}

export async function setLobsterSkillEnabled(providerConfig: Record<string, any>, id: string, enabled: boolean) {
  const baseUrl = normalizeBaseUrl(providerConfig)
  const apiKey = normalizeApiKey(providerConfig)
  const response = await fetch(`${baseUrl}/api/agent/skills/set-enabled`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id, enabled }),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(String(data?.error || `Set enabled error (${response.status})`))
  }
  return Array.isArray(data?.skills) ? data.skills : []
}

export async function getLobsterSkillConfig(providerConfig: Record<string, any>, id: string) {
  const baseUrl = normalizeBaseUrl(providerConfig)
  const apiKey = normalizeApiKey(providerConfig)
  const response = await fetch(`${baseUrl}/api/agent/skills/get-config`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id }),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(String(data?.error || `Get config error (${response.status})`))
  }
  return (data?.config || {}) as Record<string, string>
}

export async function setLobsterSkillConfig(providerConfig: Record<string, any>, id: string, config: Record<string, string>) {
  const baseUrl = normalizeBaseUrl(providerConfig)
  const apiKey = normalizeApiKey(providerConfig)
  const response = await fetch(`${baseUrl}/api/agent/skills/set-config`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id, config }),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(String(data?.error || `Set config error (${response.status})`))
  }
  return !!data?.success
}

export async function downloadLobsterSkill(providerConfig: Record<string, any>, source: string) {
  const baseUrl = normalizeBaseUrl(providerConfig)
  const apiKey = normalizeApiKey(providerConfig)
  const response = await fetch(`${baseUrl}/api/agent/skills/download`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ source }),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(String(data?.error || `Download skill error (${response.status})`))
  }
  return {
    success: !!data?.success,
    skills: Array.isArray(data?.skills) ? data.skills : [],
    auditReport: (data?.auditReport || null) as LobsterSkillAuditReport | null,
    pendingInstallId: typeof data?.pendingInstallId === 'string' ? data.pendingInstallId : '',
  }
}

export async function confirmLobsterSkillInstall(providerConfig: Record<string, any>, pendingInstallId: string, action: 'install' | 'installDisabled' | 'cancel') {
  const baseUrl = normalizeBaseUrl(providerConfig)
  const apiKey = normalizeApiKey(providerConfig)
  const response = await fetch(`${baseUrl}/api/agent/skills/confirm-install`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ pendingInstallId, action }),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(String(data?.error || `Confirm install error (${response.status})`))
  }
  return {
    success: !!data?.success,
    skills: Array.isArray(data?.skills) ? data.skills : [],
  }
}

export async function streamLobsterBridge(options: StreamLobsterBridgeOptions) {
  const {
    airiSessionId,
    text,
    systemPrompt,
    model,
    providerConfig,
    imageAttachments = [],
    fileAttachments = [],
    skillIds = [],
    onEvent,
  } = options

  const baseUrl = normalizeBaseUrl(providerConfig)
  const apiKey = normalizeApiKey(providerConfig)
  await bindSession(baseUrl, apiKey, airiSessionId)
  const fileIds = await uploadFiles(baseUrl, apiKey, airiSessionId, fileAttachments)
  const userContent = buildUserContent(text, imageAttachments)

  const response = await fetch(`${baseUrl}/api/agent/bridge/chat`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      airiSessionId,
      model,
      systemPrompt,
      stream: true,
      fileIds,
      skillIds,
      messages: [{ role: 'user', content: userContent }],
    }),
  })

  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new Error(String(data?.error || `Lobster bridge error (${response.status})`))
  }
  if (!response.body) {
    throw new Error('Lobster bridge returned empty stream body')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

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
      let json: LobsterBridgeEvent | null = null
      try {
        json = JSON.parse(payload) as LobsterBridgeEvent
      }
      catch {
        json = null
      }
      if (json) {
        await onEvent(json)
      }
    }
  }
}

export async function respondLobsterPermission(providerConfig: Record<string, any>, airiSessionId: string, requestId: string, decision: 'allow' | 'deny') {
  const baseUrl = normalizeBaseUrl(providerConfig)
  const apiKey = normalizeApiKey(providerConfig)
  const response = await fetch(`${baseUrl}/api/agent/bridge/permission`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      airiSessionId,
      requestId,
      decision,
    }),
  })
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new Error(String(data?.error || `Permission response error (${response.status})`))
  }
}

export async function getLobsterPermissionStatus(providerConfig: Record<string, any>, airiSessionId: string, requestId: string) {
  const baseUrl = normalizeBaseUrl(providerConfig)
  const apiKey = normalizeApiKey(providerConfig)
  const response = await fetch(`${baseUrl}/api/agent/bridge/permission/status`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      airiSessionId,
      requestId,
    }),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(String(data?.error || `Permission status error (${response.status})`))
  }
  return {
    status: String(data?.status || 'not_found'),
    expiresAt: typeof data?.expiresAt === 'number' ? data.expiresAt : undefined,
  }
}

export async function listLobsterPendingPermissions(providerConfig: Record<string, any>, airiSessionId: string) {
  const baseUrl = normalizeBaseUrl(providerConfig)
  const apiKey = normalizeApiKey(providerConfig)
  const response = await fetch(`${baseUrl}/api/agent/bridge/permission/list`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      airiSessionId,
    }),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(String(data?.error || `Permission list error (${response.status})`))
  }
  const permissions = Array.isArray(data?.permissions) ? data.permissions : []
  return permissions.map((item: any) => ({
    requestId: String(item?.requestId || ''),
    toolName: String(item?.toolName || ''),
    toolInput: typeof item?.toolInput === 'object' && item?.toolInput ? item.toolInput as Record<string, unknown> : {},
    createdAt: typeof item?.createdAt === 'number' ? item.createdAt : Date.now(),
    expiresAt: typeof item?.expiresAt === 'number' ? item.expiresAt : undefined,
    turnId: typeof item?.turnId === 'string' ? item.turnId : '',
  })).filter((item: { requestId: string }) => !!item.requestId)
}
