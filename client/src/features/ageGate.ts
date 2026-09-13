// First-run gates (Google Play policy): a neutral age screen (18+ only, which
// keeps the app out of the Families Policy entirely) and acceptance of the
// Terms before the user can do anything. Both are stored per-device in
// localStorage — matching how appearance prefs are stored, and enough for the
// policy ("show an age screen"); there is deliberately no server column.

import { Capacitor } from '@capacitor/core'

const AGE_KEY = 'ageVerified'
const TERMS_KEY = 'termsAcceptedAt'
const MIN_AGE = 18

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private mode — the gate just shows again next launch */
  }
}

function ageFrom(year: number, month: number, day: number): number {
  const today = new Date()
  let age = today.getFullYear() - year
  const hadBirthday = today.getMonth() + 1 > month || (today.getMonth() + 1 === month && today.getDate() >= day)
  if (!hadBirthday) age--
  return age
}

function selectOptions(from: number, to: number, label: string): string {
  let out = `<option value="">${label}</option>`
  for (let n = from; n <= to; n++) out += `<option value="${n}">${n}</option>`
  return out
}

// Renders into `root` and resolves once BOTH gates are cleared. Never resolves
// for an under-18 (dead-end screen) — that's the intent.
export function ensureFirstRunGates(root: HTMLElement): Promise<void> {
  if (read(AGE_KEY) === '1' && read(TERMS_KEY)) return Promise.resolve()

  return new Promise<void>((resolve) => {
    const showConsent = (): void => {
      if (read(TERMS_KEY)) {
        resolve()
        return
      }
      root.innerHTML = `
        <div class="screen">
          <div class="screen__eyebrow">BEFORE YOU START</div>
          <div class="screen__title">A few ground rules.</div>
          <div class="screen__subtitle">
            One on One is a private space for two people. Harassment, hate, and any
            sexual content involving minors are not allowed and will be acted on.
          </div>
          <label class="age-gate__agree">
            <input type="checkbox" id="agree-check" />
            <span>I am 18 or older and I agree to the
              <a href="/terms" ${Capacitor.isNativePlatform() ? '' : 'target="_blank" rel="noopener"'}>Terms</a> and
              <a href="/privacy" ${Capacitor.isNativePlatform() ? '' : 'target="_blank" rel="noopener"'}>Privacy Policy</a>.</span>
          </label>
          <div class="screen__actions">
            <button class="primary" id="agree-btn" disabled>Agree and continue</button>
          </div>
        </div>
      `
      const check = root.querySelector<HTMLInputElement>('#agree-check')!
      const btn = root.querySelector<HTMLButtonElement>('#agree-btn')!
      check.addEventListener('change', () => {
        btn.disabled = !check.checked
      })
      btn.addEventListener('click', () => {
        write(TERMS_KEY, new Date().toISOString())
        resolve()
      })
    }

    const showDeadEnd = (): void => {
      root.innerHTML = `
        <div class="screen">
          <div class="screen__eyebrow">SORRY</div>
          <div class="screen__title">You need to be 18 to use One on One.</div>
          <div class="screen__subtitle">Thanks for checking it out.</div>
        </div>
      `
    }

    const showAge = (): void => {
      if (read(AGE_KEY) === '1') {
        showConsent()
        return
      }
      const thisYear = new Date().getFullYear()
      root.innerHTML = `
        <div class="screen">
          <div class="screen__eyebrow">ONE MORE THING</div>
          <div class="screen__title">What's your date of birth?</div>
          <div class="screen__subtitle">One on One is for adults only.</div>
          <div class="age-gate__dob">
            <select id="dob-day" aria-label="Day">${selectOptions(1, 31, 'Day')}</select>
            <select id="dob-month" aria-label="Month">${selectOptions(1, 12, 'Month')}</select>
            <select id="dob-year" aria-label="Year">${selectOptions(thisYear - 100, thisYear, 'Year')}</select>
          </div>
          <div class="screen__subtitle screen__error" id="dob-error"></div>
          <div class="screen__actions">
            <button class="primary" id="dob-btn">Continue</button>
          </div>
        </div>
      `
      const day = root.querySelector<HTMLSelectElement>('#dob-day')!
      const month = root.querySelector<HTMLSelectElement>('#dob-month')!
      const year = root.querySelector<HTMLSelectElement>('#dob-year')!
      const errorEl = root.querySelector<HTMLDivElement>('#dob-error')!

      root.querySelector<HTMLButtonElement>('#dob-btn')!.addEventListener('click', () => {
        if (!day.value || !month.value || !year.value) {
          errorEl.textContent = 'Please pick a full date.'
          errorEl.style.display = 'block'
          return
        }
        const age = ageFrom(Number(year.value), Number(month.value), Number(day.value))
        if (age < MIN_AGE) {
          showDeadEnd()
          return
        }
        write(AGE_KEY, '1')
        showConsent()
      })
    }

    showAge()
  })
}
