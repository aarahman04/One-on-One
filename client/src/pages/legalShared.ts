// Shared chrome + content for the public legal pages (Privacy, Terms, Child
// Safety). These routes are reachable signed-out — see main.ts, which mounts
// them before the session lookup and the age/consent gate.
//
// The body strings below are mirrored verbatim into
// client/public/legal/{privacy,terms,child-safety}.html (standalone copies for
// any external link, e.g. the Play Console privacy-policy URL). Keep the two in
// sync when editing.

export const DEVELOPER_NAME = 'Ahmed Abdul Rahman'
export const CONTACT_EMAIL = 'aarahman803@gmail.com'
export const CHILD_SAFETY_CONTACT = 'Ahmed Abdul Rahman (aarahman803@gmail.com)'
export const JURISDICTION = 'Telangana, India'
export const LAST_UPDATED = '9 September 2026'

// {{DOMAIN}} is left as a literal token: no custom domain is registered yet, so
// the concrete URL is the current Vercel deployment. Swapped for a real domain
// in one place when one exists.
const DOMAIN = '{{DOMAIN}}'

export function legalShell(title: string, body: string): string {
  return `
    <div class="legal">
      <nav class="legal__nav">
        <button type="button" id="legal-back" class="legal__back">&larr; Back</button>
        <div class="legal__navlinks">
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="/child-safety">Child Safety</a>
        </div>
      </nav>
      <article class="legal__doc">
        <h1>${title}</h1>
        <p class="legal__meta">Last updated ${LAST_UPDATED} &middot; ${DEVELOPER_NAME}</p>
        ${body}
      </article>
    </div>`
}

// Back button: step back if there's history (opened from an in-app link), else
// go to the app root (opened directly or in a fresh tab).
export function wireLegalBack(root: HTMLElement): () => void {
  const btn = root.querySelector<HTMLButtonElement>('#legal-back')
  const onClick = (): void => {
    if (window.history.length > 1) window.history.back()
    else window.location.assign('/')
  }
  btn?.addEventListener('click', onClick)
  return () => btn?.removeEventListener('click', onClick)
}

export const privacyBody = `
  <p>One on One is a private one-to-one messaging app. This policy explains what
  it collects, why, who it is shared with, how long it is kept, and how to have
  it deleted. It covers the app in every form &mdash; the website at ${DOMAIN}
  and the Android app that wraps that same website.</p>

  <h2>Who is responsible</h2>
  <p>${DEVELOPER_NAME} is the data controller for One on One. Contact:
  <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>

  <h2>What is collected</h2>
  <ul>
    <li><strong>Account</strong> &mdash; when you sign in with Google we receive
      your email address, display name, profile photo URL and Google account
      identifier. We also generate a short connection code for you.</li>
    <li><strong>Messages</strong> &mdash; the text, captions, letter bodies and
      slash-command card fields you send, plus structured payload for each
      message type. Message content and payload are encrypted at rest.</li>
    <li><strong>Photos, voice notes and files</strong> you send &mdash; stored as
      files in a private bucket and served through short-lived (about one hour)
      signed links. Before a photo is uploaded, the app re-encodes it in your
      browser to strip embedded EXIF metadata, including any GPS location, from
      non-animated images.</li>
    <li><strong>Location</strong> &mdash; only when you use the
      <code>/location</code> command. A single coordinate reading
      (latitude, longitude, accuracy) is sent as a message and encrypted at
      rest. The app does not track your location in the background.</li>
    <li><strong>Call records</strong> &mdash; for each voice or video call, a row
      recording the kind, outcome and duration, encrypted at rest. Call audio and
      video are peer-to-peer and are never recorded, transcribed or stored.</li>
    <li><strong>Reactions, nicknames and read / delivery timestamps</strong>
      &mdash; stored in plain text.</li>
    <li><strong>Push subscription</strong> &mdash; if you turn on notifications,
      the browser push endpoint and its keys, one per device.</li>
    <li><strong>Reports</strong> &mdash; if you report a message or a person, the
      reason, category, your note, the reporter and reported account identifiers,
      and an encrypted snapshot of the reported message.</li>
    <li><strong>On your device only</strong> &mdash; whether you have signed in
      before, appearance preferences, your age / terms acknowledgement, and your
      sign-in token. These stay in your browser and are not sent to us as data we
      store about you.</li>
  </ul>
  <p>One on One does <strong>not</strong> collect or store your IP address,
  device fingerprint, contacts, phone number, SMS or call logs, advertising ID,
  or any analytics or behavioural event data. There are no advertising or
  analytics SDKs in the app.</p>

  <h2>How it is used</h2>
  <p>Data is used only to run the service: to authenticate you, to deliver
  messages, calls, reactions and location cards between you and the one person
  you are connected to, to send notifications you have opted into, and to review
  safety reports. It is not used for advertising or profiling.</p>

  <h2>Who it is shared with</h2>
  <p>We do not sell personal or sensitive data and never will. Data is processed
  by the following service providers so the app can function:</p>
  <ul>
    <li><strong>Supabase</strong> &mdash; database, authentication and file
      storage for everything listed above.</li>
    <li><strong>Vercel</strong> &mdash; website and content-delivery hosting;
      processes request logs including your IP address in transit.</li>
    <li><strong>Railway</strong> &mdash; backend server hosting.</li>
    <li><strong>Cloudflare</strong> &mdash; STUN on every call and, for roughly
      10&ndash;20% of calls behind restrictive networks, a TURN relay. When
      relaying, Cloudflare handles the encrypted media packets and sees both
      participants' IP addresses.</li>
    <li><strong>Browser push services</strong> (Google, Mozilla, Apple,
      Microsoft, depending on your browser) &mdash; deliver notifications. The
      payload is encrypted per RFC&nbsp;8291, but the notification preview text
      and sender nickname are visible to the push service and on your lock
      screen. For text messages this preview can include up to about 120
      characters of the message.</li>
    <li><strong>OpenStreetMap</strong> &mdash; when a <code>/location</code> card
      is visible, your browser fetches map tiles from
      <code>tile.openstreetmap.org</code>, which receives the shared coordinates
      and the viewing device's IP address.</li>
    <li><strong>Google</strong> &mdash; OAuth sign-in; and Google Maps only if
      you tap a location card's directions link (an external link, no SDK).</li>
  </ul>
  <p>Fonts are self-hosted, so loading the app does not disclose your IP to a
  font provider.</p>

  <h2>Security</h2>
  <p>All traffic uses HTTPS / WSS (TLS). Message content and payload, location
  readings and call records are additionally encrypted at rest with AES-256-GCM.
  Uploaded file bytes rely on the storage provider's disk encryption.</p>
  <p>One on One is <strong>not</strong> end-to-end encrypted. The server can
  technically access message content in order to operate the service and review
  reports. Call media is peer-to-peer (DTLS-SRTP) and is not accessible to the
  server. Because calls are peer-to-peer, the two participants' devices exchange
  IP addresses directly during a call.</p>

  <h2>Retention</h2>
  <p>There is no scheduled deletion. Data is kept until one of the following
  happens:</p>
  <ul>
    <li>The connection ends &mdash; the entire conversation (messages, media,
      reactions, call records) is deleted for both people.</li>
    <li>You delete your account &mdash; your account and everything cascading
      from it is removed.</li>
  </ul>
  <p>Report records are deliberately kept after a connection ends or an account
  is deleted, as safety evidence. The link to the original message is severed
  and the reported account identifier is cleared, but the encrypted snapshot and
  the reason are retained.</p>

  <h2>Deleting your account</h2>
  <p>You can delete your account and its data at any time:</p>
  <ul>
    <li><strong>In the app</strong> &mdash; open the &bull;&bull;&bull; menu (or
      the connection-ID screen) and choose &ldquo;Delete account&rdquo;.</li>
    <li><strong>On the web</strong> &mdash; visit
      <a href="/delete-account">/delete-account</a> and follow the steps there.</li>
  </ul>
  <p>Deletion removes your authentication record, your app profile, your
  connection, and every message, reaction, call record, block and push
  subscription tied to your account. Report records are retained as described
  above. Deletion cannot be undone.</p>

  <h2>Your choices</h2>
  <p>Notifications, appearance and location sharing are all opt-in and can be
  turned off at any time. To request access to or correction of your data, email
  <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>

  <h2>Children</h2>
  <p>One on One is for adults only. You must be 18 or older to use it. It is not
  directed to children and we do not knowingly collect data from anyone under
  18. See the <a href="/child-safety">Child Safety</a> page.</p>

  <h2>Changes</h2>
  <p>If this policy changes materially, the &ldquo;last updated&rdquo; date above
  will change and the app will surface the update. Continued use after a change
  means you accept the revised policy.</p>

  <h2>Contact</h2>
  <p>Privacy questions: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>
`

export const termsBody = `
  <p>These Terms of Service (&ldquo;Terms&rdquo;) are a contract between you and
  ${DEVELOPER_NAME} (&ldquo;we&rdquo;, &ldquo;us&rdquo;) governing your use of
  One on One. By ticking the acceptance box at first run, or by using the app,
  you agree to these Terms. If you do not agree, do not use One on One.</p>

  <h2>1. Eligibility</h2>
  <p>You must be at least 18 years old to use One on One. By using it you confirm
  that you are 18 or older. We may terminate any account we believe belongs to a
  person under 18.</p>

  <h2>2. What One on One is</h2>
  <p>One on One connects exactly two people in a single private conversation.
  You hold one connection at a time. Ending a connection permanently deletes that
  conversation for both people. The service is provided as-is; features may
  change or be withdrawn.</p>

  <h2>3. Your account</h2>
  <p>You sign in with Google. You are responsible for activity under your
  account and for keeping your Google account secure. You may delete your account
  at any time from within the app or at
  <a href="/delete-account">/delete-account</a>.</p>

  <h2>4. Acceptable use</h2>
  <p>You agree not to use One on One to:</p>
  <ul>
    <li>harass, threaten, stalk, bully or intimidate another person;</li>
    <li>send hate speech or content that attacks or demeans a person or group on
      the basis of race, ethnicity, religion, disability, sex, gender identity,
      sexual orientation, or similar characteristics;</li>
    <li>share sexual content involving a minor, or any content that sexualises,
      exploits or endangers a child &mdash; this is prohibited absolutely and has
      zero tolerance (see the <a href="/child-safety">Child Safety</a> page);</li>
    <li>share non-consensual intimate imagery, or sexual content forced on a
      recipient who has not agreed to receive it;</li>
    <li>send spam, scams, phishing, malware or unlawful content;</li>
    <li>impersonate another person or misrepresent your identity to deceive;</li>
    <li>infringe someone else's intellectual-property or privacy rights;</li>
    <li>attempt to break, overload, probe or circumvent the security or access
      controls of the service.</li>
  </ul>

  <h2>5. Your content</h2>
  <p>You keep ownership of everything you send. You grant us only the limited
  right to store, transmit and display your content to the other participant in
  order to operate the service, and to retain encrypted report snapshots for
  safety review. We do not use your content for advertising or to train models.</p>

  <h2>6. Safety, reporting and enforcement</h2>
  <p>You can block the other person at any time (this ends the conversation
  immediately and prevents future contact) and report a message or a person from
  the in-app menu. Reports are reviewed by a real person. We may remove content,
  end a connection, or suspend or delete an account that violates these Terms.
  Serious violations, including child sexual abuse material, are reported to the
  appropriate authorities. Our process is described in our internal moderation
  policy and summarised on the <a href="/child-safety">Child Safety</a> page.</p>

  <h2>7. Termination</h2>
  <p>You may stop using One on One and delete your account at any time. We may
  suspend or terminate your access if you breach these Terms or if required by
  law. Provisions that by their nature should survive termination (ownership,
  disclaimers, limitation of liability, governing law) survive.</p>

  <h2>8. Disclaimers</h2>
  <p>One on One is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;,
  without warranties of any kind, to the fullest extent permitted by law. We do
  not warrant that the service will be uninterrupted, timely, secure or
  error-free, or that messages or calls will always be delivered.</p>

  <h2>9. Limitation of liability</h2>
  <p>To the fullest extent permitted by law, we are not liable for indirect,
  incidental, special, consequential or punitive damages, or for any loss of
  data, arising from your use of One on One.</p>

  <h2>10. Governing law</h2>
  <p>These Terms are governed by the laws of ${JURISDICTION}, and the courts of
  ${JURISDICTION} have exclusive jurisdiction, without regard to conflict-of-law
  rules and without affecting any mandatory consumer-protection rights you have
  where you live.</p>

  <h2>11. Changes</h2>
  <p>We may update these Terms. If a change is material, the &ldquo;last
  updated&rdquo; date will change and the app will ask you to accept again.
  Continued use after a change means you accept the revised Terms.</p>

  <h2>12. Contact</h2>
  <p><a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>
`

export const childSafetyBody = `
  <p>One on One has zero tolerance for child sexual abuse and exploitation
  (CSAE), including any content that sexualises, exploits or endangers a person
  under 18. This page sets out our standards and what we do about violations. It
  supplements the <a href="/terms">Terms of Service</a>.</p>

  <h2>Our standards</h2>
  <ul>
    <li>One on One is for adults. Users must be 18 or older, and a neutral
      age check is shown at first run.</li>
    <li>Child sexual abuse material (CSAM), grooming, sextortion, and any
      sexualisation of a minor are strictly prohibited and will be acted on.</li>
    <li>We comply with applicable child-safety laws and reporting obligations.</li>
  </ul>

  <h2>How to report</h2>
  <p>In any conversation, open the &bull;&bull;&bull; menu and choose
  &ldquo;Report message&rdquo; or &ldquo;Report&nbsp;[person]&rdquo;, and select
  the <strong>Child safety</strong> category. You can also report and block in a
  single action. Reports include an encrypted snapshot of the reported content so
  they can be reviewed even after the conversation is deleted.</p>
  <p>You can also email <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>
  directly.</p>

  <h2>What we do</h2>
  <p>Child-safety reports are prioritised and handled on discovery, ahead of the
  normal review window. On a credible report or on becoming aware of CSAM, we:</p>
  <ul>
    <li>preserve the evidence (content, account identifiers and timestamps);</li>
    <li>report it to the National Center for Missing &amp; Exploited Children
      (NCMEC) through the CyberTipline at
      <a href="https://report.cybertip.org" target="_blank" rel="noopener">report.cybertip.org</a>,
      and to other authorities where required;</li>
    <li>remove the content and permanently ban the account;</li>
    <li>record the incident, including any NCMEC report number.</li>
  </ul>

  <h2>Point of contact</h2>
  <p>Child-safety point of contact: ${CHILD_SAFETY_CONTACT}.</p>
`
