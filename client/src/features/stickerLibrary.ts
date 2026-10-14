import builtins from './stickerPacks'
export interface Sticker { id: string; owner: string; title: string; pack?: string; blob: Blob; created: number; used: number; favourite: boolean }
let epoch = 0
let opening: Promise<IDBDatabase> | undefined
function database(): Promise<IDBDatabase> {
  return opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('one-on-one-local-media', 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('stickers', { keyPath: ['owner', 'id'] })
      req.result.createObjectStore('state')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => { opening = undefined; reject(req.error) }
  })
}
function result<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error) })
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Could not save in this browser.')) })
}
export async function clearLocalMedia(): Promise<void> {
  epoch++
  const db = await database(), tx = db.transaction(['stickers', 'state'], 'readwrite')
  tx.objectStore('stickers').clear(); tx.objectStore('state').clear()
  await done(tx)
}
export async function loadStickers(owner: string): Promise<Sticker[]> {
  const start = epoch, db = await database()
  const seeded = await result(db.transaction('state').objectStore('state').get(owner))
  if (!seeded) {
    const assets = await Promise.all(builtins.map(async (asset, i) => {
      const res = await fetch(asset.url)
      if (!res.ok) throw new Error('Could not load the built-in stickers.')
      return { ...asset, owner, blob: await res.blob(), created: builtins.length - i, used: 0, favourite: false }
    }))
    if (start !== epoch) throw new Error('Account changed.')
    const tx = db.transaction(['stickers', 'state'], 'readwrite')
    const completion = done(tx)
    const state = tx.objectStore('state'), check = state.get(owner)
    check.onsuccess = () => { if (!check.result) { assets.forEach((s) => tx.objectStore('stickers').put(s)); state.put(true, owner) } }
    await completion
  }
  if (start !== epoch) throw new Error('Account changed.')
  const all = await result(db.transaction('stickers').objectStore('stickers').getAll()) as Sticker[]
  return all.filter((s) => s.owner === owner)
}
export async function saveSticker(sticker: Sticker, start = epoch): Promise<void> {
  const db = await database()
  if (start !== epoch) throw new Error('Account changed. Reopen the sticker library.')
  const tx = db.transaction('stickers', 'readwrite'); tx.objectStore('stickers').put(sticker); await done(tx)
}
export const mediaEpoch = (): number => epoch
export async function deleteSticker(owner: string, id: string): Promise<void> {
  const db = await database(), tx = db.transaction('stickers', 'readwrite')
  tx.objectStore('stickers').delete([owner, id]); await done(tx)
}
export async function privatePhoto(owner: string, connectionId: string, blob?: Blob | null): Promise<Blob | null> {
  const start = epoch, db = await database(), key = `photo:${owner}:${connectionId}`
  if (start !== epoch) throw new Error('Account changed.')
  if (blob !== undefined) {
    const tx = db.transaction('state', 'readwrite'), store = tx.objectStore('state')
    if (blob) store.put(blob, key); else store.delete(key)
    await done(tx)
  }
  return await result(db.transaction('state').objectStore('state').get(key)) ?? null
}
