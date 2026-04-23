import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useVisionStore } from './vision'

describe('vision store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('updates auto capture and speech attach flags', () => {
    const store = useVisionStore()

    store.setAutoCaptureEnabled(true)
    store.setSpeechAutoAttachEnabled(true)

    expect(store.autoCaptureEnabled).toBe(true)
    expect(store.speechAutoAttachEnabled).toBe(true)
    expect(store.autoCaptureIntervalMs).toBe(2000)
  })

  it('throttles repeated captures within the configured interval', async () => {
    const store = useVisionStore()
    store.previewStream = { getTracks: () => [] } as unknown as MediaStream
    store.status = 'previewing'
    store.lastCaptureAt = Date.now()

    await expect(store.captureFrame({ videoWidth: 320, videoHeight: 240 } as HTMLVideoElement, { throttleMs: 1000 }))
      .rejects
      .toThrow('camera-capture-throttled')

    expect(store.captureThrottleCount).toBe(1)
  })

  it('records successful captures when throttle is bypassed', async () => {
    const store = useVisionStore()
    const originalDocument = globalThis.document
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: () => {} }),
      toDataURL: () => 'data:image/jpeg;base64,Zm9v',
    }

    globalThis.document = {
      createElement: () => fakeCanvas,
    } as unknown as Document

    store.previewStream = { getTracks: () => [] } as unknown as MediaStream
    store.status = 'previewing'

    const result = await store.captureFrame({ videoWidth: 640, videoHeight: 480 } as HTMLVideoElement, { bypassThrottle: true })

    expect(result.dataUrl).toBe('data:image/jpeg;base64,Zm9v')
    expect(store.captureCount).toBe(1)
    expect(store.status).toBe('previewing')
    expect(store.lastCaptureAt).toBeGreaterThan(0)

    globalThis.document = originalDocument
  })

  it('blocks overlapping captures while one capture is still in flight', async () => {
    const store = useVisionStore()
    store.previewStream = { getTracks: () => [] } as unknown as MediaStream
    store.status = 'previewing'
    store.isCaptureInFlight = true

    await expect(store.captureFrame({ videoWidth: 640, videoHeight: 480 } as HTMLVideoElement, { bypassThrottle: true }))
      .rejects
      .toThrow('camera-capture-in-flight')

    expect(store.captureThrottleCount).toBe(1)
  })
})
