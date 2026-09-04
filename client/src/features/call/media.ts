// The single chokepoint for getUserMedia. Every call path (audio + video)
// acquires local media through here — isolating it means a native Android
// permission bridge later is a one-file change, not a hunt through call code
// (see plan's Android permission notes).

// Checked before ever inviting/accepting, so an unsupported browser gets a
// clear message up front instead of only failing once ringing has already
// started (an insecure http:// origin — not localhost, not https — also
// fails this, since getUserMedia requires a secure context).
export function callingSupported(): boolean {
  return typeof RTCPeerConnection !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

export type CameraFacing = 'user' | 'environment'

// `facing` only applies to video calls; audio calls ignore it. `facingMode`
// is a plain preference (not `exact`), so a laptop with one non-facing webcam
// still gets a stream instead of an OverconstrainedError. `withAudio: false`
// is for the front/back switch mid-call — it only needs the new video track,
// the existing mic stays put.
export async function acquireLocalStream(
  kind: 'audio' | 'video',
  facing: CameraFacing = 'user',
  withAudio = true,
): Promise<MediaStream> {
  const constraints: MediaStreamConstraints =
    kind === 'video' ? { audio: withAudio, video: { facingMode: facing } } : { audio: true, video: false }
  return navigator.mediaDevices.getUserMedia(constraints)
}

// Whether to show the front/back flip control. Best-effort: labels are empty
// until a getUserMedia grant exists, so this is only meaningful once a call is
// already up — and even then some browsers report a single "default" device.
export async function hasMultipleCameras(): Promise<boolean> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices.filter((d) => d.kind === 'videoinput').length > 1
  } catch {
    return false
  }
}

export function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop()
}
