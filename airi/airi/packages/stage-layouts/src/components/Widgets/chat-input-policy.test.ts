import { describe, expect, it } from 'vitest'

import { CHAT_ATTACHMENT_LIMITS, shouldAutoSendTranscription, validateChatAttachment } from './chat-input-policy'

function createFile(name: string, type: string, size: number) {
  return new File([new Uint8Array(size)], name, { type })
}

describe('chat input policy', () => {
  it('allows supported images', () => {
    const file = createFile('photo.png', 'image/png', 1024)

    expect(validateChatAttachment(file, { currentCount: 0, supportsBridgeFiles: false })).toEqual({
      ok: true,
      attachmentType: 'image',
    })
  })

  it('blocks regular files when bridge uploads are unavailable', () => {
    const file = createFile('notes.pdf', 'application/pdf', 1024)

    expect(validateChatAttachment(file, { currentCount: 0, supportsBridgeFiles: false })).toEqual({
      ok: false,
      reason: 'bridge_only_file',
      attachmentType: 'file',
    })
  })

  it('blocks files that exceed the image size limit', () => {
    const file = createFile('large.webp', 'image/webp', (CHAT_ATTACHMENT_LIMITS.maxImageSizeMb * 1024 * 1024) + 1)

    expect(validateChatAttachment(file, { currentCount: 0, supportsBridgeFiles: true })).toEqual({
      ok: false,
      reason: 'too_large',
      attachmentType: 'image',
    })
  })

  it('blocks attachments after the maximum count is reached', () => {
    const file = createFile('photo.jpg', 'image/jpeg', 1024)

    expect(validateChatAttachment(file, {
      currentCount: CHAT_ATTACHMENT_LIMITS.maxAttachments,
      supportsBridgeFiles: true,
    })).toEqual({
      ok: false,
      reason: 'too_many',
    })
  })

  it('auto-sends meaningful transcription text', () => {
    expect(shouldAutoSendTranscription('帮我看看这张图片')).toBe(true)
  })

  it('does not auto-send filler-only transcription text', () => {
    expect(shouldAutoSendTranscription('嗯')).toBe(false)
    expect(shouldAutoSendTranscription('...')).toBe(false)
  })
})
