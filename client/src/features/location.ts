import { openModal } from '../components/Modal'
import { showToast } from '../components/Toast'

// The /location slash command: a one-shot snapshot, not live location
// sharing — there's no update path, so a location message is immutable
// history like every other message (see the message row it renders through,
// buildMessageRow → .chat__message-body). Coordinates are rounded to 5
// decimal places (~1m) on capture; no reason to persist more precision.

export interface LocationPayload {
  lat: number
  lng: number
  accuracy?: number
}

function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5
}

// Denial/failure maps the same way callErrorMessage does in call/controller.ts.
function geoErrorMessage(err: GeolocationPositionError): string {
  if (err.code === err.PERMISSION_DENIED) return 'Location access was denied'
  return "Couldn't get your location"
}

export function captureLocation(): Promise<LocationPayload> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: round5(pos.coords.latitude),
          lng: round5(pos.coords.longitude),
          accuracy: pos.coords.accuracy != null ? Math.round(pos.coords.accuracy) : undefined,
        })
      },
      (err) => reject(new Error(geoErrorMessage(err))),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    )
  })
}

// Sharing your exact coordinates is too easy to misfire without a confirm
// step — same shape as confirmSendAlarm in alarm.ts, asked BEFORE the
// browser's own permission prompt so the user knows what they're granting
// access for.
export function openLocationConfirm(opts: { peerName: string; onConfirm: () => void }): void {
  const { peerName, onConfirm } = opts
  const container = document.createElement('div')
  container.className = 'location-confirm'
  // peerName is the peer's own nickname (arbitrary user text) — built via
  // textContent below, not interpolated into innerHTML.
  container.innerHTML = `
    <div class="msg-compose__title">Share your location?</div>
    <p class="location-confirm__body"></p>
    <div class="msg-compose__actions">
      <button type="button" id="location-cancel">Cancel</button>
      <button type="button" id="location-send" class="primary">Share location</button>
    </div>
  `
  container.querySelector('.location-confirm__body')!.textContent =
    `This sends your current coordinates to ${peerName} as a permanent part of this conversation.`
  const modal = openModal(container)
  container.querySelector('#location-cancel')!.addEventListener('click', () => modal.close())
  container.querySelector('#location-send')!.addEventListener('click', () => {
    modal.close()
    onConfirm()
  })
}

// Ties the confirm → geolocation → error-toast flow together; ChatPage only
// needs to hand it a way to actually send the resulting message.
export function writeLocationFlow(peerName: string, onCaptured: (content: string, payload: LocationPayload) => void): void {
  if (!navigator.geolocation) {
    showToast("Location isn't supported in this browser")
    return
  }
  openLocationConfirm({
    peerName,
    onConfirm: () => {
      void captureLocation()
        .then((payload) => onCaptured(`${payload.lat}, ${payload.lng}`, payload))
        .catch((err: Error) => showToast(err.message))
    },
  })
}
