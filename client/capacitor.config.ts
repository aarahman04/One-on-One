import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.web.oneonone',
  appName: 'One on One',
  webDir: 'dist',
  // Native project lives at the repo root, beside backend/ and client/.
  android: {
    path: '../android',
  },
  server: {
    // Default. The app is served from https://localhost inside the WebView —
    // a secure context, which getUserMedia and geolocation require.
    androidScheme: 'https',
  },
}

export default config
