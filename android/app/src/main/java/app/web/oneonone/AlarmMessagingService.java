package app.web.oneonone;

import android.app.NotificationManager;
import android.content.Intent;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

// Subclasses (rather than replaces) the push-notifications plugin's own
// FirebaseMessagingService so the existing JS relay (pushNotificationReceived
// / onNewToken) and normal message-notification display keep working unchanged
// (super.onMessageReceived runs first for every message) — this only adds a
// branch for the backend's alarm data-only sends (pushService.ts
// sendFcmToUser). Registered in the manifest in place of the plugin's own
// service (removed there via tools:node="remove"): only one
// FirebaseMessagingService can own the com.google.firebase.MESSAGING_EVENT
// intent-filter.
public class AlarmMessagingService extends MessagingService {

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);

        Map<String, String> data = remoteMessage.getData();
        if (!"alarm".equals(data.get("type"))) return;

        String alarmId = data.get("alarmId");
        boolean ack = "true".equals(data.get("ack"));
        if (ack) {
            // Raiser cancelled (an ack from the recipient goes to the raiser, who
            // is not ringing). Stopping doesn't need the foreground-service-start
            // exemption a fresh start does. The service ignores an alarmId that
            // doesn't match the ringing alarm.
            try {
                startService(AlarmForegroundService.stopIntent(this, alarmId));
            } catch (IllegalStateException e) {
                // Background-start restriction: nothing ringing that we could stop anyway.
            }
            return;
        }

        // The chat is open and the live socket already handles this raise
        // (ChatPage.ts onIncoming) — ringing again here would double the sound.
        // Anywhere else (other screen, backgrounded, killed) nothing in JS
        // rings, so this native ring is the only thing the user hears.
        if (AppState.foreground && AppState.chatActive) return;

        try {
            ContextCompat.startForegroundService(this, AlarmForegroundService.ringIntent(this, alarmId));
        } catch (IllegalStateException e) {
            // ForegroundServiceStartNotAllowedException (API 31+) is an
            // IllegalStateException subclass. Fall back to a high-priority
            // alarm-category notification with a full-screen intent.
            postFallbackNotification(alarmId);
        }
    }

    private void postFallbackNotification(String alarmId) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        AlarmForegroundService.newToken(); // fallback intents carry a token too
        try {
            manager.notify(AlarmForegroundService.NOTIFICATION_ID, AlarmForegroundService.buildNotification(this, alarmId, true));
        } catch (SecurityException e) {
            /* POST_NOTIFICATIONS denied — nothing more we can do */
        }
    }
}
