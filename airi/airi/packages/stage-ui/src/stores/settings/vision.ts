import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'

export const useSettingsVision = defineStore('settings-vision', () => {
  const cameraFrameEnabled = useLocalStorageManualReset<boolean>('settings/vision/camera-frame-enabled', false)
  const cameraFrameAutoGreetingEnabled = useLocalStorageManualReset<boolean>('settings/vision/camera-frame-auto-greeting-enabled', true)
  const cameraFrameAutoCaptureIntervalMs = useLocalStorageManualReset<number>('settings/vision/camera-frame-auto-capture-interval-ms', 2000)
  const cameraFrameAutoSendEnabled = useLocalStorageManualReset<boolean>('settings/vision/camera-frame-auto-send-enabled', true)
  const cameraFrameAutoSendDelayMs = useLocalStorageManualReset<number>('settings/vision/camera-frame-auto-send-delay-ms', 5000)

  function resetState() {
    cameraFrameEnabled.reset()
    cameraFrameAutoGreetingEnabled.reset()
    cameraFrameAutoCaptureIntervalMs.reset()
    cameraFrameAutoSendEnabled.reset()
    cameraFrameAutoSendDelayMs.reset()
  }

  return {
    cameraFrameEnabled,
    cameraFrameAutoGreetingEnabled,
    cameraFrameAutoCaptureIntervalMs,
    cameraFrameAutoSendEnabled,
    cameraFrameAutoSendDelayMs,
    resetState,
  }
})
