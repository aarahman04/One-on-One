import type { Page } from '../state/router'
import { legalShell, privacyBody, wireLegalBack } from './legalShared'

export const PrivacyPage: Page = (root) => {
  root.innerHTML = legalShell('Privacy Policy', privacyBody)
  return wireLegalBack(root)
}
