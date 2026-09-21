package app.web.oneonone;

import android.content.Intent;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

// Subclasses (rather than replaces) the push-notifications plugin's own
// FirebaseMessagingService so the existing JS relay (pushNotificationReceived
// / onNewToken) keeps working unchanged — this only adds a branch for the
// backend's alarm data-only sends (pushService.ts sendFcmToUser). Registered
// in the manifest in place of the plugin's own service (removed there via
// tools:node="remove"): only one FirebaseMessagingService can own the
// com.google.firebase.MESSAGING_EVENT intent-filter.
public class AlarmMessagingService extends MessagingService {

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);

        Map<String, String> data = remoteMessage.getData();
        if (!"alarm".equals(data.get("type"))) return;

        boolean ack = "true".equals(data.get("ack"));
        if (ack) {
            // Stopping doesn't need the foreground-service-start exemption a
            // fresh start does — a plain startService is enough to deliver the
            // stop action to an already (or still) running service.
            startService(AlarmForegroundService.stopIntent(this));
            return;
        }

        // The chat is open and the live socket already handles this raise
        // (ChatPage.ts onIncoming) — ringing again here would double the sound.
        // Backgrounded or killed, that in-app path is silent (Web Audio is
        // throttled/suspended outside the foreground), so this native ring is
        // the only thing the user actually hears.
        if (AppState.foreground) return;

        Intent intent = AlarmForegroundService.ringIntent(this);
        ContextCompat.startForegroundService(this, intent);
    }
}
