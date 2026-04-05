import type { ChatHistoryItem } from './chat'

export interface ChatSessionBridgeFileRef {
  id: string
  name: string
  mimeType: string
  size?: number
  uploadedAt: number
  bindingState?: 'active' | 'stale'
  lobsterSessionId?: string
  clientTurnId?: string
}

export type ChatSessionBridgeMode = 'text-fast' | 'agent'
export type ChatSessionBridgeBindingStatus = 'unbound' | 'bound' | 'rebound' | 'stale'

export interface ChatSessionBridgeState {
  fileRefs?: ChatSessionBridgeFileRef[]
  sessionMode?: ChatSessionBridgeMode
  lobsterSessionId?: string
  bindingStatus?: ChatSessionBridgeBindingStatus
  lastBoundAt?: number
}

export interface ChatSessionMeta {
  sessionId: string
  userId: string
  characterId: string
  title?: string
  bridgeState?: ChatSessionBridgeState
  createdAt: number
  updatedAt: number
}

export interface ChatSessionRecord {
  meta: ChatSessionMeta
  messages: ChatHistoryItem[]
}

export interface ChatCharacterSessionsIndex {
  activeSessionId: string
  sessions: Record<string, ChatSessionMeta>
}

export interface ChatSessionsIndex {
  userId: string
  characters: Record<string, ChatCharacterSessionsIndex>
}

export interface ChatSessionsExport {
  format: 'chat-sessions-index:v1'
  index: ChatSessionsIndex
  sessions: Record<string, ChatSessionRecord>
}
