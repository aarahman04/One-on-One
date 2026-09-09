import type { Page } from '../state/router'
import { childSafetyBody, legalShell, wireLegalBack } from './legalShared'

export const ChildSafetyPage: Page = (root) => {
  root.innerHTML = legalShell('Child Safety', childSafetyBody)
  return wireLegalBack(root)
}
