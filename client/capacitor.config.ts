import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.web.oneonone',
  appName: 'One on One',
  webDir: 'dist',
  backgroundColor: '#0d1117',
  // Native project lives at the repo root, beside backend/ and client/.
  android: {
    path: '../android',
  },
  server: {
    // Default. The app is served from https://localhost inside the WebView —
    // a secure context, which getUserMedia and geolocation require.
    androidScheme: 'https',
  },
  plugins: {
    SocialLogin: {
      // Only Google sign-in is used. Disabling the rest keeps their native SDKs
      // (notably the Facebook SDK) out of the APK.
      providers: {
        google: true,
        facebook: false,
        apple: false,
        twitter: false,
      },
    },
    SplashScreen: {
      // main.ts calls SplashScreen.hide() itself once the app is ready
      // (same min/max timing as the web in-app splash) — auto-hide would race
      // that and dismiss the native splash before boot routing finishes.
      launchAutoHide: false,
      backgroundColor: '#0d1117',
      androidScaleType: 'CENTER',
      showSpinner: false,
    },
  },
}

export default config
