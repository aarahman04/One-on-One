package app.web.oneonone;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

// Rings the /alarm emergency alert natively — the one path that actually
// produces sound when the app is backgrounded or fully killed (a WebView's
// Web Audio is throttled/suspended by Android outside the foreground, per
// features/alarm.ts's own comment on that exact limitation; a plain FCM
// notification, meanwhile, is silent and easy to miss). Mirrors
// features/alarm.ts's raise/ack/2-minute-auto-clear shape and vibration
// pattern so native and in-app behavior read the same.
public class AlarmForegroundService extends Service {

    static final String ACTION_RING = "app.web.oneonone.ALARM_RING";
    static final String ACTION_STOP = "app.web.oneonone.ALARM_STOP";

    private static final String CHANNEL_ID = "alarm";
    private static final int NOTIFICATION_ID = 2;
    private static final long AUTO_CLEAR_MS = 2 * 60_000L; // matches AUTO_CLEAR_MS in alarm.ts
    private static final long[] VIBRATE_PATTERN = { 0, 300, 150, 300, 150, 300, 150, 300 }; // matches VIBRATE_PATTERN in alarm.ts (leading 0 = no initial delay)

    private MediaPlayer player;
    private Vibrator vibrator;
    private final Handler autoClearHandler = new Handler(Looper.getMainLooper());
    private final Runnable autoClear = this::stopRinging;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) {
            stopRinging();
            return START_NOT_STICKY;
        }

        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // No dedicated "alarm" foreground-service type exists pre-API 34;
            // mediaPlayback is the closest accurate declaration for a service
            // whose whole job is playing a looping sound.
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        startRinging();
        autoClearHandler.removeCallbacks(autoClear);
        autoClearHandler.postDelayed(autoClear, AUTO_CLEAR_MS);
        return START_NOT_STICKY;
    }

    private void startRinging() {
        stopPlayerAndVibrator(); // idempotent — a repeat raise while already ringing just restarts cleanly
        try {
            player = MediaPlayer.create(this, R.raw.alarm);
            if (player != null) {
                player.setAudioAttributes(
                        new AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_ALARM)
                                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                                .build());
                player.setLooping(true);
                player.start();
            }
        } catch (Exception e) {
            // Best-effort — the notification itself (heads-up + full-screen intent)
            // still alerts the user even if playback fails on a given device.
        }

        vibrator = getVibrator();
        if (vibrator != null && vibrator.hasVibrator()) {
            vibrator.vibrate(VibrationEffect.createWaveform(VIBRATE_PATTERN, 0)); // repeat from index 0
        }
    }

    private void stopPlayerAndVibrator() {
        if (player != null) {
            try {
                player.stop();
            } catch (Exception e) {
                /* not started / already stopped — ignore */
            }
            player.release();
            player = null;
        }
        if (vibrator != null) {
            vibrator.cancel();
        }
    }

    private void stopRinging() {
        autoClearHandler.removeCallbacks(autoClear);
        stopPlayerAndVibrator();
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private Vibrator getVibrator() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager manager = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            return manager != null ? manager.getDefaultVibrator() : null;
        }
        return (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
    }

    private Notification buildNotification() {
        ensureChannel();

        Intent contentIntent = new Intent(this, MainActivity.class);
        contentIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentPendingIntent = PendingIntent.getActivity(
                this,
                0,
                contentIntent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(getString(R.string.alarm_notification_title))
                .setContentText(getString(R.string.alarm_notification_text))
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setOngoing(true)
                .setAutoCancel(false)
                .setContentIntent(contentPendingIntent)
                // Attempts to wake/turn on the screen over the lock screen, same as
                // an incoming call — requires USE_FULL_SCREEN_INTENT (manifest).
                .setFullScreenIntent(contentPendingIntent, true);

        return builder.build();
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        // IMPORTANCE_HIGH + no channel sound: MediaPlayer above owns the actual
        // alarm audio (USAGE_ALARM, loud + loops), so the channel itself stays
        // silent to avoid layering a second, shorter default notification sound.
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                getString(R.string.alarm_notification_channel_name),
                NotificationManager.IMPORTANCE_HIGH);
        channel.setSound(null, null);
        channel.enableVibration(false); // MediaPlayer + Vibrator above own timing; a channel vibration would double up
        manager.createNotificationChannel(channel);
    }

    static Intent ringIntent(Context context) {
        Intent intent = new Intent(context, AlarmForegroundService.class);
        intent.setAction(ACTION_RING);
        return intent;
    }

    static Intent stopIntent(Context context) {
        Intent intent = new Intent(context, AlarmForegroundService.class);
        intent.setAction(ACTION_STOP);
        return intent;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        autoClearHandler.removeCallbacks(autoClear);
        stopPlayerAndVibrator();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
