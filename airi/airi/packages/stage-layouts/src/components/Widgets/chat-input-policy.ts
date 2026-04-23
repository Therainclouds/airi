const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
const FILE_MIME_TYPES = ['application/pdf', 'text/plain', 'text/markdown', 'text/csv', 'application/json'] as const

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'] as const
const FILE_EXTENSIONS = ['.pdf', '.txt', '.md', '.markdown', '.csv', '.json'] as const

const MAX_ATTACHMENTS = 4
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024
const MIN_AUTO_SEND_TEXT_LENGTH = 2
const AUTO_SEND_FILLERS = new Set(['嗯', '啊', '哦', '呃', '唉', '欸', 'uh', 'um', 'hmm'])

export const CHAT_ATTACHMENT_ACCEPT = [
  ...IMAGE_MIME_TYPES,
  ...FILE_MIME_TYPES,
].join(',')

export const CHAT_ATTACHMENT_LIMITS = {
  maxAttachments: MAX_ATTACHMENTS,
  maxImageSizeMb: Math.floor(MAX_IMAGE_SIZE_BYTES / 1024 / 1024),
  maxFileSizeMb: Math.floor(MAX_FILE_SIZE_BYTES / 1024 / 1024),
  maxImageSizeBytes: MAX_IMAGE_SIZE_BYTES,
  maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
}

export type ValidatedAttachmentType = 'image' | 'file'
export type AttachmentValidationReason = 'too_many' | 'unsupported_type' | 'too_large' | 'bridge_only_file'

export interface ValidateAttachmentOptions {
  currentCount: number
  supportsBridgeFiles: boolean
}

export type AttachmentValidationResult
  = | { ok: true, attachmentType: ValidatedAttachmentType }
    | { ok: false, reason: AttachmentValidationReason, attachmentType?: ValidatedAttachmentType }

function hasSupportedExtension(fileName: string, extensions: readonly string[]) {
  const lowerCaseName = fileName.toLowerCase()
  return extensions.some(extension => lowerCaseName.endsWith(extension))
}

function resolveAttachmentType(file: File): ValidatedAttachmentType | undefined {
  if (IMAGE_MIME_TYPES.includes(file.type as typeof IMAGE_MIME_TYPES[number]) || hasSupportedExtension(file.name, IMAGE_EXTENSIONS))
    return 'image'

  if (FILE_MIME_TYPES.includes(file.type as typeof FILE_MIME_TYPES[number]) || hasSupportedExtension(file.name, FILE_EXTENSIONS))
    return 'file'

  return undefined
}

export function validateChatAttachment(file: File, options: ValidateAttachmentOptions): AttachmentValidationResult {
  if (options.currentCount >= MAX_ATTACHMENTS) {
    return { ok: false, reason: 'too_many' }
  }

  const attachmentType = resolveAttachmentType(file)
  if (!attachmentType) {
    return { ok: false, reason: 'unsupported_type' }
  }

  if (attachmentType === 'file' && !options.supportsBridgeFiles) {
    return { ok: false, reason: 'bridge_only_file', attachmentType }
  }

  const sizeLimit = attachmentType === 'image' ? MAX_IMAGE_SIZE_BYTES : MAX_FILE_SIZE_BYTES
  if (file.size > sizeLimit) {
    return { ok: false, reason: 'too_large', attachmentType }
  }

  return { ok: true, attachmentType }
}

export function normalizeTranscriptionText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

export function shouldAutoSendTranscription(value: string) {
  const normalized = normalizeTranscriptionText(value)
  if (!normalized)
    return false

  const semanticText = normalized.replace(/[\s\p{P}\p{S}]+/gu, '')
  if (semanticText.length < MIN_AUTO_SEND_TEXT_LENGTH)
    return false

  if (AUTO_SEND_FILLERS.has(semanticText.toLowerCase()))
    return false

  return true
}
