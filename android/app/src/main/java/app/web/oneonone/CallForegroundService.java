package app.web.oneonone;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

// A plain started foreground service that exists only to keep the app's process
// and its WebRTC media alive while an active call is backgrounded. The TWA got
// this for free from Chrome keeping its own process alive; the Capacitor shell
// has to ask for it. No ConnectionService, no dialer role — declaring
// MANAGE_OWN_CALLS in the manifest is enough for the phoneCall service type.
public class CallForegroundService extends Service {

    static final String ACTION_STOP = "app.web.oneonone.CALL_SERVICE_STOP";
    static final String EXTRA_KIND = "kind"; // "audio" | "video"

    private static final String CHANNEL_ID = "calls";
    private static final int NOTIFICATION_ID = 1;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }

        String kind = intent != null ? intent.getStringExtra(EXTRA_KIND) : null;
        Notification notification = buildNotification("video".equals(kind));

        // Must happen within ~5s of the service starting or Android kills it.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        return START_NOT_STICKY;
    }

    private Notification buildNotification(boolean video) {
        ensureChannel();

        Intent contentIntent = new Intent(this, MainActivity.class);
        PendingIntent contentPendingIntent = PendingIntent.getActivity(
                this,
                0,
                contentIntent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        String text = video
                ? getString(R.string.call_notification_text_video)
                : getString(R.string.call_notification_text_audio);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(getString(R.string.app_name))
                .setContentText(text)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setOngoing(true)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setContentIntent(contentPendingIntent)
                .build();
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        // IMPORTANCE_LOW on purpose: the app plays its own ringtone and /alarm
        // sound, so a higher importance would add a second OS sound.
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                getString(R.string.call_notification_channel_name),
                NotificationManager.IMPORTANCE_LOW);
        manager.createNotificationChannel(channel);
    }

    static Intent stopIntent(Context context) {
        Intent intent = new Intent(context, CallForegroundService.class);
        intent.setAction(ACTION_STOP);
        return intent;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
