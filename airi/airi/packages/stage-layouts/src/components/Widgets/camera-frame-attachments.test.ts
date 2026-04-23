import { describe, expect, it } from 'vitest'

import { clearCameraDraftAttachments, createCameraFrameAttachment, getCameraDraftAttachments, isCameraFrameAttachment, upsertCameraDraftAttachment } from './camera-frame-attachments'

describe('camera frame attachments', () => {
  it('creates a local image attachment from a camera frame', () => {
    const attachment = createCameraFrameAttachment('data:image/jpeg;base64,Zm9v', 'camera-frame-test.jpg')

    expect(attachment).toEqual({
      source: 'local',
      type: 'image',
      data: 'Zm9v',
      mimeType: 'image/jpeg',
      name: 'camera-frame-test.jpg',
    })
  })

  it('replaces the previous camera draft while preserving other attachments', () => {
    const first = createCameraFrameAttachment('data:image/jpeg;base64,Zm9v', 'camera-frame-1.jpg')
    const second = createCameraFrameAttachment('data:image/jpeg;base64,YmFy', 'camera-frame-2.jpg')
    const next = upsertCameraDraftAttachment([
      first,
      { source: 'local', type: 'file', data: 'dGVzdA==', mimeType: 'text/plain', name: 'note.txt' },
    ], second)

    expect(next).toEqual([
      { source: 'local', type: 'file', data: 'dGVzdA==', mimeType: 'text/plain', name: 'note.txt' },
      second,
    ])
  })

  it('finds and clears camera draft attachments', () => {
    const draft = createCameraFrameAttachment('data:image/jpeg;base64,Zm9v', 'camera-frame-3.jpg')
    const attachments = [
      draft,
      { source: 'history', type: 'file', historyFileId: 'history-1', mimeType: 'application/pdf', name: 'paper.pdf' } as const,
    ]

    expect(isCameraFrameAttachment(draft)).toBe(true)
    expect(getCameraDraftAttachments(attachments)).toEqual([draft])
    expect(clearCameraDraftAttachments(attachments)).toEqual([
      { source: 'history', type: 'file', historyFileId: 'history-1', mimeType: 'application/pdf', name: 'paper.pdf' },
    ])
  })
})
