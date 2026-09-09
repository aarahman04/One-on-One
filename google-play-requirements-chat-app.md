# Google Play Requirements Checklist — 1-on-1 Chat App

Based on Google Play's Developer Program Policy. Use this while building so compliance is baked in, not bolted on later.

> **First, confirm one thing:** does your app connect people who don't already know each other (matching, discovery, "chat with strangers"), or is it strictly for people who already know each other (like a messaging feature between existing contacts/users of a service)? Some requirements below (marked ⚠️) only kick in for the first case — but it's safer to build them in either way, since Google can classify your app as "Social" once messaging is a core feature.

---

## 1. Developer Account (Play Console)
- [ ] Register a Play Console account with accurate legal name, address, contact email/phone, and payment profile.
- [ ] Register as an **Organization** account instead of Personal only if you also offer financial services, health/medical features, VPN, or are a government entity (not typical for a chat app, but confirm).

## 2. Privacy Policy (mandatory, no exceptions)
- [ ] Publish a privacy policy at a **live, public URL** (not a PDF, not geofenced).
- [ ] Clearly label it "Privacy Policy."
- [ ] Name your company/developer (must match what's on your store listing).
- [ ] Disclose exactly what data you collect (messages, photos/videos sent, contacts, location, device/usage data) and how it's used, shared, secured, retained, and deleted.
- [ ] Include a contact method for privacy inquiries.
- [ ] Link it both in Play Console **and** inside the app itself (e.g., in settings or onboarding).

## 3. Data Safety Section (Play Console form)
- [ ] Fill out accurately — must match your privacy policy word-for-word in substance.
- [ ] Include data handled by any third-party SDKs (analytics, crash reporting, chat backend, push notifications, etc.), not just your own code.
- [ ] Keep it updated every time you change what data you collect.

## 4. Permissions — request only what you need
- [ ] **Camera/Microphone/Photos:** fine to request if used for chat features (photo sharing, voice/video messages, video calls) — but you must show a clear, prominent explanation *before* the permission prompt and get affirmative consent, not just the OS default prompt.
- [ ] **Contacts:** only request if a feature genuinely needs it (e.g., "find friends already on the app"). Don't request it just to grow your user base or for marketing — this is a common rejection reason.
- [ ] **SMS / Call Log permissions:** avoid entirely unless your app is registered as the device's default SMS or Phone handler. Google restricts these heavily — a chat app almost never qualifies, so don't request `READ_SMS`, `READ_CALL_LOG`, etc.
- [ ] **Location:** only request if a feature needs it (e.g., "nearby users"); never request it solely for analytics or ads.
- [ ] Remove any permission from your manifest that isn't tied to a real, documented feature.

## 5. In-App User Safety & Moderation (this is the big one for a chat app)
Since your core feature is user-to-user messaging, Google treats this as User-Generated Content (UGC) and requires:
- [ ] **Terms of Service / Community Guidelines** that users must accept before chatting, clearly defining and prohibiting harassment, hate speech, sexual content involving minors, and other objectionable behavior.
- [ ] **In-app Block function** — required for any 1:1 messaging feature. Users must be able to block another user from contacting them.
- [ ] **In-app Report function** — users must be able to report a person or a specific message/content as objectionable.
- [ ] A real internal process for reviewing reports and taking action (warnings, content removal, bans) — not just a form that goes nowhere.
- [ ] If AR, image, or video sharing is involved, your moderation must also cover objectionable images/video, not just text.

## 6. ⚠️ Child Safety Standards Policy (required if your app matches "Anonymous Chat," "Random Chat," "Social," or "Dating" categories)
If people can meet/chat with others they don't already know, you must self-certify all of the following in Play Console:
- [ ] Publicly published standards that explicitly prohibit Child Sexual Abuse and Exploitation (CSAE) — put this in your ToS/community guidelines.
- [ ] An in-app mechanism for users to submit feedback/concerns/reports (covered by #5 above if built well).
- [ ] A documented process to act on and remove CSAM (Child Sexual Abuse Material) once you become aware of it.
- [ ] Compliance with applicable child safety laws, including a process to report confirmed CSAM to NCMEC or the relevant regional authority.
- [ ] A designated **Child Safety Point of Contact** — a real person/role Google can reach about CSAE issues.

## 7. Age & Content Suitability
- [ ] Complete the Content Rating questionnaire accurately, including questions about UGC/chat features.
- [ ] If minors could plausibly use the app, add an age screen and consider whether you need to comply with the separate **Families Policy** (different, stricter data/ads rules — flag me if this applies).
- [ ] Any nudity/sexual content exchanged between users must not be actively promoted or default-visible; illegal or CSAE content is never permitted, with no exceptions.

## 8. Account & Data Controls
- [ ] Allow users to **delete their account** — this must work both in-app and via an external web page/resource (not just an email request).
- [ ] Transmit all data (especially chat content) securely — modern encryption in transit (HTTPS/TLS) at minimum.
- [ ] Never sell personal or sensitive user data to third parties.

## 9. Store Listing & Metadata
- [ ] Description, screenshots, and video must accurately show real app functionality — no staged/fake screenshots.
- [ ] Provide a working demo/test account and login instructions in Play Console so Google's reviewers can actually test the chat flow (matching, messaging, blocking, reporting).

## 10. Technical Requirements
- [ ] Target an Android API level within one year of the latest major Android release (checked at every submission and update).

## 11. Deceptive Behavior / Malware
- [ ] Don't mimic OS/system notifications or dialogs.
- [ ] Any device setting changes must be user-consented and reversible.
- [ ] No hidden data collection or behavior not disclosed in your listing/privacy policy.

## 12. If You Show Ads or Monetize
- [ ] Ads shown must match your app's content rating.
- [ ] Any ad SDK/mediation platform you use must itself be compliant with Google Play policies.
- [ ] If you use personal/sensitive data (chat behavior, contacts) to serve ads, that must be disclosed and consented to separately — don't repurpose chat data for ad targeting without explicit consent.

---

### Priority order if you're early in development
1. Build blocking + reporting into the chat UI from day one — retrofitting this is painful.
2. Write your Privacy Policy and ToS/Community Guidelines before your first submission — Play Console review checks these first.
3. Decide now whether this is "chat with people you know" or "chat with new people," since that determines whether Section 6 applies.
4. Keep your permission list minimal — every extra permission is a review risk.
