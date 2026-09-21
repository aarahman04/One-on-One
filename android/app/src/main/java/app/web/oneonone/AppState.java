package app.web.oneonone;

// Toggled by MainActivity.onResume/onPause. AlarmMessagingService reads this
// to decide whether the JS layer is already handling an incoming alarm (via
// its live socket + Web Audio, chat visibly open) or whether the native
// foreground ring is the only thing that will actually be heard — backgrounded
// or killed, a WebView's audio is throttled/suspended by Android regardless
// of the socket still being connected (see features/alarm.ts's own comment
// on this same platform restriction).
final class AppState {
    static volatile boolean foreground = false;

    private AppState() {}
}
