package app.web.oneonone;

// foreground is toggled by MainActivity.onResume/onPause; chatActive by
// AlarmPlugin.setChatActive (ChatPage mount/unmount). AlarmMessagingService
// skips the native ring only when BOTH are true: the app is visible AND the
// chat page (the only place the JS alarm path lives) is mounted. Visible on any
// other screen, nothing in JS would ring, so native must.
final class AppState {
    static volatile boolean foreground = false;
    static volatile boolean chatActive = false;

    private AppState() {}
}
