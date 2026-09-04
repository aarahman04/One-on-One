// TURN credential minting for WebRTC calls (spec: audio/video calling, batch 1).
// TURN is only needed when two peers can't reach each other directly (roughly
// 10-20% of calls, behind symmetric NAT); the rest connect peer-to-peer via
// free STUN. TURN_KEY_ID / TURN_API_TOKEN are optional — when unset, calls
// still work for most network pairs on STUN alone, they just can't relay
// across the toughest NATs. Never expose TURN_API_TOKEN to the client; only
// the short-lived credentials this mints are ever returned.

export interface IceServer {
  urls: string | string[]
  username?: string
  credential?: string
}

const STUN_SERVERS: IceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }]

const TURN_KEY_ID = process.env.TURN_KEY_ID
const TURN_API_TOKEN = process.env.TURN_API_TOKEN

// Long enough to cover call setup (offer/answer + ICE gathering), short
// enough that a leaked credential is useless within minutes.
const CREDENTIAL_TTL_SECONDS = 120

// getIceServers runs on every call:invite AND call:accept, so a straight call
// hits Cloudflare twice per call from a cold path. Cache the minted set
// briefly — a credential served at the end of this window still has 90s of
// validity left, plenty for ICE gathering, and the Cloudflare round-trip
// drops out of the call:accept path whenever a call happened recently.
const CACHE_TTL_MS = 30_000
let cached: { servers: IceServer[]; at: number } | null = null

if (!TURN_KEY_ID || !TURN_API_TOKEN) {
  console.warn('TURN_KEY_ID/TURN_API_TOKEN not set — calls will use STUN only (no relay across strict NAT)')
}

export async function getIceServers(): Promise<IceServer[]> {
  if (!TURN_KEY_ID || !TURN_API_TOKEN) return STUN_SERVERS
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.servers

  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TURN_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ttl: CREDENTIAL_TTL_SECONDS }),
      },
    )
    if (!res.ok) {
      console.error('turnService: Cloudflare credential request failed', res.status, await res.text())
      return STUN_SERVERS
    }
    const data = (await res.json()) as { iceServers?: IceServer | IceServer[] }
    const servers = data.iceServers ? (Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers]) : []
    if (!servers.length) return STUN_SERVERS
    cached = { servers, at: Date.now() }
    return servers
  } catch (err) {
    // Best-effort, same stance as pushService/syncDelivery: never fail the
    // call because the TURN vendor is unreachable — degrade to STUN.
    console.error('turnService: failed to mint TURN credentials, falling back to STUN', err)
    return STUN_SERVERS
  }
}
