export function gateStorageKeys(owner: string) {
  return { age: `ageVerified:${owner}`, terms: `termsAcceptedAt:${owner}` }
}

export function forgetFirstRunGates(owner: string): void {
  try {
    const keys = gateStorageKeys(owner)
    localStorage.removeItem(keys.age)
    localStorage.removeItem(keys.terms)
  } catch { /* unavailable storage will show the gates again */ }
}
