import type { Page } from '../state/router'
import { legalShell, termsBody, wireLegalBack } from './legalShared'

export const TermsPage: Page = (root) => {
  root.innerHTML = legalShell('Terms of Service', termsBody)
  return wireLegalBack(root)
}
