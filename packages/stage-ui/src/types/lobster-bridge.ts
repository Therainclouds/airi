// ==================== Event Envelope ====================

/** Base envelope carried by every Lobster Bridge event */
interface BridgeEventEnvelope {
  sessionId: string
  turnId: string
  seq: number
  createdAt: number
}

// ==================== Event Type Union ====================

type LobsterBridgeEvent
  = | SessionBoundEvent
    | StateChangedEvent
    | AssistantDeltaEvent
    | AssistantFinalEvent
    | ReasoningDeltaEvent
    | ReasoningFinalEvent
    | ToolCallEvent
    | ToolResultEvent
    | PermissionRequestEvent
    | DoneEvent
    | ErrorEvent

// ==================== Individual Event Definitions ====================

interface SessionBoundEvent extends BridgeEventEnvelope {
  type: 'session.bound'
  payload: {
    airiSessionId: string
    lobsterSessionId: string
  }
}

interface StateChangedEvent extends BridgeEventEnvelope {
  type: 'state.changed'
  payload: {
    state: 'think' | 'tool_use' | 'ask_user' | 'success' | 'error'
  }
}

interface AssistantDeltaEvent extends BridgeEventEnvelope {
  type: 'assistant.delta'
  payload: {
    delta: string
  }
}

interface AssistantFinalEvent extends BridgeEventEnvelope {
  type: 'assistant.final'
  payload: {
    content: string
  }
}

interface ReasoningDeltaEvent extends BridgeEventEnvelope {
  type: 'reasoning.delta'
  payload: {
    delta: string
  }
}

interface ReasoningFinalEvent extends BridgeEventEnvelope {
  type: 'reasoning.final'
  payload: {
    content: string
  }
}

interface ToolCallEvent extends BridgeEventEnvelope {
  type: 'tool.call'
  payload: {
    id: string
    name: string
    input: Record<string, unknown>
  }
}

interface ToolResultEvent extends BridgeEventEnvelope {
  type: 'tool.result'
  payload: {
    id: string
    result: string
  }
}

interface PermissionRequestEvent extends BridgeEventEnvelope {
  type: 'permission.request'
  payload: {
    requestId: string
    capabilityToken: string
    toolName: string
    toolInput: Record<string, unknown>
    expiresAt: number
  }
}

interface DoneEvent extends BridgeEventEnvelope {
  type: 'done'
  payload: Record<string, never>
}

interface ErrorEvent extends BridgeEventEnvelope {
  type: 'error'
  payload: {
    message: string
    code?: string
  }
}

// ==================== Request / Response Types ====================

interface LobsterBridgeChatRequest {
  airiSessionId: string
  model: string
  stream: true
  messages: BridgeMessage[]
  fileIds?: string[]
  skillIds?: string[]
}

interface BridgeMessage {
  role: 'user' | 'assistant' | 'system'
  content: string | BridgeContentPart[]
}

type BridgeContentPart
  = | { type: 'text', text: string }
    | { type: 'image_url', image_url: { url: string } }

interface FileUploadRequest {
  airiSessionId: string
  name: string
  mimeType: string
  base64Data: string
}

interface FileUploadResponse {
  file: {
    id: string
    name: string
    mimeType: string
    size: number
  }
}

interface SessionBindRequest {
  airiSessionId: string
}

interface SessionBindResponse {
  session: {
    airiSessionId: string
    lobsterSessionId: string
  }
}

interface PermissionRespondRequest {
  airiSessionId: string
  requestId: string
  capabilityToken: string
  decision: 'allow' | 'deny'
}

// ==================== Skill Types ====================

interface LobsterSkill {
  id: string
  name: string
  enabled: boolean
  description?: string
  isBuiltIn?: boolean
}

interface SkillSecurityFinding {
  dimension?: string
  severity?: string
  description?: string
  file?: string
  line?: number
}

interface SkillSecurityReport {
  skillName?: string
  riskLevel?: string
  riskScore?: number
  findings?: SkillSecurityFinding[]
  scanDurationMs?: number
}

interface SkillDownloadRequest {
  source: string
}

interface SkillDownloadResponse {
  success: boolean
  auditReport?: SkillSecurityReport
  pendingInstallId?: string
}

interface SkillConfirmInstallRequest {
  pendingInstallId: string
  action: 'install' | 'installDisabled' | 'cancel'
}

// ==================== Streaming Options ====================

interface StreamLobsterBridgeOptions {
  baseUrl: string
  apiKey: string
  request: LobsterBridgeChatRequest
  signal?: AbortSignal
  onStateChange?: (state: StateChangedEvent['payload']['state']) => void
  onPermissionRequest?: (payload: PermissionRequestEvent['payload']) => void
}

// ==================== Error Class ====================

class LobsterBridgeError extends Error {
  constructor(
    message: string,
    public code?: string,
    public responseStatus?: number,
  ) {
    super(message)
    this.name = 'LobsterBridgeError'
  }
}

// ==================== Exports ====================

export type {
  AssistantDeltaEvent,
  AssistantFinalEvent,
  BridgeContentPart,
  BridgeEventEnvelope,
  BridgeMessage,
  DoneEvent,
  ErrorEvent,
  FileUploadRequest,
  FileUploadResponse,
  LobsterBridgeChatRequest,
  LobsterBridgeEvent,
  LobsterSkill,
  PermissionRequestEvent,
  PermissionRespondRequest,
  ReasoningDeltaEvent,
  ReasoningFinalEvent,
  SessionBindRequest,
  SessionBindResponse,
  SessionBoundEvent,
  SkillConfirmInstallRequest,
  SkillDownloadRequest,
  SkillDownloadResponse,
  SkillSecurityFinding,
  SkillSecurityReport,
  StateChangedEvent,
  StreamLobsterBridgeOptions,
  ToolCallEvent,
  ToolResultEvent,
}

export { LobsterBridgeError }
