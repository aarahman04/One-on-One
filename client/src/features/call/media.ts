// The single chokepoint for getUserMedia. Every call path (audio now, video
// in batch 7) acquires local media through here — isolating it means a
// native Android permission bridge later is a one-file change, not a hunt
// through call code (see plan's Android permission notes).

export async function acquireLocalStream(kind: 'audio' | 'video'): Promise<MediaStream> {
  const constraints: MediaStreamConstraints = kind === 'video' ? { audio: true, video: true } : { audio: true, video: false }
  return navigator.mediaDevices.getUserMedia(constraints)
}

export function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop()
}
