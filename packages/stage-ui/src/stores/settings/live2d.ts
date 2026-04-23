import { useLocalStorageManualReset, useVersionedLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'

import { EMOTION_VALUES, Emotion } from '../../constants/emotions'

export const useSettingsLive2d = defineStore('settings-live2d', () => {
  type EmotionMotionRef = { fileName: string, motionName: string, motionIndex: number }
  const createEmotionMotionMap = (): Record<Emotion, EmotionMotionRef[]> => EMOTION_VALUES.reduce((acc, emotion) => {
    acc[emotion] = []
    return acc
  }, {} as Record<Emotion, EmotionMotionRef[]>)
  const live2dDisableFocus = useLocalStorageManualReset<boolean>('settings/live2d/disable-focus', false)
  const live2dIdleAnimationEnabled = useLocalStorageManualReset<boolean>('settings/live2d/idle-animation-enabled', true)
  const live2dAutoBlinkEnabled = useVersionedLocalStorageManualReset<boolean>('settings/live2d/auto-blink-enabled', false, {
    defaultVersion: '2.0.0',
    satisfiesVersionBy(beforeVersion, afterVersion) {
      if (beforeVersion === afterVersion) {
        return true
      }

      return false
    },
  })
  const live2dForceAutoBlinkEnabled = useVersionedLocalStorageManualReset<boolean>('settings/live2d/force-auto-blink-enabled', true, {
    defaultVersion: '2.0.0',
    satisfiesVersionBy(beforeVersion, afterVersion) {
      if (beforeVersion === afterVersion) {
        return true
      }

      return false
    },
  })
  const live2dExpressionEnabled = useLocalStorageManualReset<boolean>('settings/live2d/expression-enabled', false)
  const live2dShadowEnabled = useLocalStorageManualReset<boolean>('settings/live2d/shadow-enabled', true)
  const live2dMaxFps = useLocalStorageManualReset<number>('settings/live2d/max-fps', 0)
<<<<<<< HEAD
  const live2dDebugControlsEnabled = useLocalStorageManualReset<boolean>('settings/live2d/debug-controls-enabled', false)
  const live2dEmotionMotionMap = useLocalStorageManualReset<Record<Emotion, EmotionMotionRef[]>>('settings/live2d/emotion-motion-map', createEmotionMotionMap)
=======
  const live2dRenderScale = useLocalStorageManualReset<number>('settings/live2d/render-scale', 2)
>>>>>>> origin/main

  function resetState() {
    live2dDisableFocus.reset()
    live2dIdleAnimationEnabled.reset()
    live2dAutoBlinkEnabled.reset()
    live2dForceAutoBlinkEnabled.reset()
    live2dExpressionEnabled.reset()
    live2dShadowEnabled.reset()
    live2dMaxFps.reset()
<<<<<<< HEAD
    live2dDebugControlsEnabled.reset()
    live2dEmotionMotionMap.reset()
=======
    live2dRenderScale.reset()
>>>>>>> origin/main
  }

  return {
    live2dDisableFocus,
    live2dIdleAnimationEnabled,
    live2dAutoBlinkEnabled,
    live2dForceAutoBlinkEnabled,
    live2dExpressionEnabled,
    live2dShadowEnabled,
    live2dMaxFps,
<<<<<<< HEAD
    live2dDebugControlsEnabled,
    live2dEmotionMotionMap,
=======
    live2dRenderScale,
>>>>>>> origin/main
    resetState,
  }
})
