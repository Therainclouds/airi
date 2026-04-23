import type { ValidatedAttachmentType } from './chat-input-policy'

import { CHAT_ATTACHMENT_LIMITS } from './chat-input-policy'

export type ChatAttachment
  = | { source: 'local', type: 'image', data: string, mimeType: string, name: string }
    | { source: 'local', type: 'file', data: string, mimeType: string, name: string }
    | { source: 'history', type: 'file', historyFileId: string, mimeType: string, name: string, size?: number }
export type LocalChatAttachment = Extract<ChatAttachment, { source: 'local' }>
export type LocalImageChatAttachment = Extract<LocalChatAttachment, { type: 'image' }>

interface CreateLocalAttachmentOptions {
  attachmentType: ValidatedAttachmentType
  dataUrl: string
  name: string
}

function parseBase64Payload(dataUrl: string) {
  const [mimePart, data] = dataUrl.split(';base64,')
  const mimeType = mimePart?.startsWith('data:') ? mimePart.slice(5) : ''

  if (!mimeType || !data)
    throw new Error('invalid_file_payload')

  return {
    mimeType,
    data,
  }
}

function estimateBase64Size(base64Value: string) {
  const paddingLength = base64Value.endsWith('==')
    ? 2
    : base64Value.endsWith('=')
      ? 1
      : 0

  return Math.max(0, Math.floor((base64Value.length * 3) / 4) - paddingLength)
}

export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      const result = event.target?.result
      if (typeof result !== 'string') {
        reject(new Error('invalid_file_payload'))
        return
      }
      resolve(result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('failed_to_read_file'))
    reader.readAsDataURL(file)
  })
}

export function createLocalAttachment({ attachmentType, dataUrl, name }: CreateLocalAttachmentOptions): LocalChatAttachment {
  const { mimeType, data } = parseBase64Payload(dataUrl)
  return {
    source: 'local',
    type: attachmentType,
    data,
    mimeType,
    name,
  }
}

export async function createLocalAttachmentFromFile(file: File, attachmentType: ValidatedAttachmentType) {
  const dataUrl = await readFileAsDataUrl(file)
  return createLocalAttachment({
    attachmentType,
    dataUrl,
    name: file.name,
  })
}

export function createCameraFrameAttachment(dataUrl: string, name = `camera-frame-${Date.now()}.jpg`): LocalImageChatAttachment {
  const attachment = createLocalAttachment({
    attachmentType: 'image',
    dataUrl,
    name,
  }) as LocalImageChatAttachment

  if (estimateBase64Size(attachment.data) > CHAT_ATTACHMENT_LIMITS.maxImageSizeBytes)
    throw new Error('camera-frame-too-large')

  return attachment
}

export function isCameraFrameAttachment(attachment: ChatAttachment) {
  return attachment.source === 'local' && attachment.type === 'image' && attachment.name.startsWith('camera-frame-')
}

export function getCameraDraftAttachments(attachments: ChatAttachment[]) {
  return attachments.filter((attachment): attachment is LocalImageChatAttachment => isCameraFrameAttachment(attachment))
}

export function clearCameraDraftAttachments(attachments: ChatAttachment[]) {
  return attachments.filter(attachment => !isCameraFrameAttachment(attachment))
}

export function upsertCameraDraftAttachment(attachments: ChatAttachment[], nextAttachment: LocalImageChatAttachment) {
  return [
    ...clearCameraDraftAttachments(attachments),
    nextAttachment,
  ]
}

export function getLatestCameraDraftAttachment(attachments: ChatAttachment[]): LocalImageChatAttachment | undefined {
  const cameraAttachments = getCameraDraftAttachments(attachments)
  return cameraAttachments[cameraAttachments.length - 1]
}

export function hasCameraDraftAttachment(attachments: ChatAttachment[]): boolean {
  return attachments.some(isCameraFrameAttachment)
}
