import { useAudioContext } from '../stores/audio'

function matchesSignature(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value)
}

export function detectAudioMimeType(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer.slice(0, 16))

  if (matchesSignature(bytes, [0x52, 0x49, 0x46, 0x46]) && bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45)
    return 'audio/wav'

  if (matchesSignature(bytes, [0x49, 0x44, 0x33]) || bytes[0] === 0xFF)
    return 'audio/mpeg'

  if (matchesSignature(bytes, [0x4F, 0x67, 0x67, 0x53]))
    return 'audio/ogg'

  if (matchesSignature(bytes, [0x66, 0x4C, 0x61, 0x43]))
    return 'audio/flac'

  return 'audio/mpeg'
}

export function createAudioPreviewUrl(buffer: ArrayBuffer) {
  return URL.createObjectURL(new Blob([buffer], { type: detectAudioMimeType(buffer) }))
}

export async function playAudioPreview(audioPlayer: HTMLAudioElement | null, buffer: ArrayBuffer, url: string) {
  if (audioPlayer) {
    audioPlayer.pause()
    audioPlayer.currentTime = 0
    audioPlayer.src = url
    audioPlayer.load()

    try {
      await audioPlayer.play()
      return
    }
    catch {}
  }

  const { audioContext } = useAudioContext()
  if (audioContext.state === 'suspended')
    await audioContext.resume()

  const audioBuffer = await audioContext.decodeAudioData(buffer.slice(0))
  const source = audioContext.createBufferSource()
  source.buffer = audioBuffer
  source.connect(audioContext.destination)
  source.start(0)

  await new Promise<void>((resolve) => {
    source.onended = () => resolve()
  })
}
