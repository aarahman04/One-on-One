package app.web.oneonone;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
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
    static final String EXTRA_ALARM_ID = "alarmId";
    // MainActivity extras: SILENCE = a user tap (stop the ring, then open the
    // chat); SHOW = the full-screen intent (show over the lock screen, keep ringing).
    static final String EXTRA_SILENCE = "alarmSilence";
    static final String EXTRA_SHOW = "alarmShow";

    private static final String CHANNEL_ID = "alarm";
    private static final String FALLBACK_CHANNEL_ID = "alarm_fallback";
    static final int NOTIFICATION_ID = 2;
    private static final long AUTO_CLEAR_MS = 2 * 60_000L; // matches AUTO_CLEAR_MS in alarm.ts
    private static final long[] VIBRATE_PATTERN = { 0, 300, 150, 300, 150, 300, 150, 300 }; // matches VIBRATE_PATTERN in alarm.ts (leading 0 = no initial delay)

    // Read by AlarmPlugin.isRinging (JS must not also ring when native already is,
    // and must know which alarm native silenced).
    static volatile boolean ringing = false;
    static volatile String ringingAlarmId = null;
    static volatile String lastStoppedAlarmId = null;

    private MediaPlayer player;
    private Vibrator vibrator;
    private final Handler autoClearHandler = new Handler(Looper.getMainLooper());
    private final Runnable autoClear = this::stopRinging;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        String alarmId = intent != null ? intent.getStringExtra(EXTRA_ALARM_ID) : null;
        if (ACTION_STOP.equals(action)) {
            // A stop aimed at a different alarm than the one ringing (a late
            // ack/cancel for an older raise) must not silence the live one.
            if (alarmId != null && ringingAlarmId != null && !alarmId.equals(ringingAlarmId)) {
                if (!ringing) stopSelf();
                return START_NOT_STICKY;
            }
            stopRinging();
            return START_NOT_STICKY;
        }

        ringingAlarmId = alarmId;
        ringing = true;
        Notification notification = buildNotification(this, alarmId, false);
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
            // new MediaPlayer() + attributes BEFORE setDataSource/prepare is what
            // routes it to the ALARM stream; MediaPlayer.create() prepares first
            // with default (music) attributes, so setting them after is ignored.
            MediaPlayer mp = new MediaPlayer();
            mp.setAudioAttributes(
                    new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ALARM)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build());
            try (AssetFileDescriptor afd = getResources().openRawResourceFd(R.raw.alarm)) {
                mp.setDataSource(afd.getFileDescriptor(), afd.getStartOffset(), afd.getLength());
            }
            mp.setWakeMode(getApplicationContext(), PowerManager.PARTIAL_WAKE_LOCK);
            mp.setLooping(true);
            mp.prepare();
            mp.start();
            player = mp;
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
        if (ringingAlarmId != null) lastStoppedAlarmId = ringingAlarmId;
        ringing = false;
        ringingAlarmId = null;
        stopForeground(STOP_FOREGROUND_REMOVE);
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.cancel(NOTIFICATION_ID); // also clears a fallback notification
        stopSelf();
    }

    private Vibrator getVibrator() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager manager = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            return manager != null ? manager.getDefaultVibrator() : null;
        }
        return (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
    }

    // Shared with AlarmMessagingService's fallback path (foreground-service
    // start refused). `fallback` posts on a channel with its own alarm sound +
    // vibration, since no MediaPlayer is running in that case.
    static Notification buildNotification(Context context, @Nullable String alarmId, boolean fallback) {
        ensureChannels(context);

        int flags = PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT;

        // Tap: silence + open the chat.
        Intent tapIntent = new Intent(context, MainActivity.class);
        tapIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        tapIntent.putExtra(EXTRA_SILENCE, true);
        if (alarmId != null) tapIntent.putExtra(EXTRA_ALARM_ID, alarmId);
        PendingIntent tapPending = PendingIntent.getActivity(context, 0, tapIntent, flags);

        // Full-screen: show over the lock screen but keep ringing until the user acts.
        Intent showIntent = new Intent(context, MainActivity.class);
        showIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        showIntent.putExtra(EXTRA_SHOW, true);
        PendingIntent showPending = PendingIntent.getActivity(context, 1, showIntent, flags);

        PendingIntent silencePending = PendingIntent.getService(context, 2, stopIntent(context, alarmId), flags);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, fallback ? FALLBACK_CHANNEL_ID : CHANNEL_ID)
                .setContentTitle(context.getString(R.string.alarm_notification_title))
                .setContentText(context.getString(R.string.alarm_notification_text))
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setOngoing(!fallback)
                .setAutoCancel(fallback)
                .setContentIntent(tapPending)
                .addAction(0, context.getString(R.string.alarm_notification_silence), silencePending)
                // Attempts to wake/turn on the screen over the lock screen, same as
                // an incoming call — requires USE_FULL_SCREEN_INTENT (manifest).
                .setFullScreenIntent(showPending, true);

        return builder.build();
    }

    private static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        if (manager.getNotificationChannel(CHANNEL_ID) == null) {
            // IMPORTANCE_HIGH + no channel sound: MediaPlayer owns the actual
            // alarm audio (USAGE_ALARM, loud + loops), so the channel itself stays
            // silent to avoid layering a second, shorter default notification sound.
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    context.getString(R.string.alarm_notification_channel_name),
                    NotificationManager.IMPORTANCE_HIGH);
            channel.setSound(null, null);
            channel.enableVibration(false); // MediaPlayer + Vibrator own timing; a channel vibration would double up
            manager.createNotificationChannel(channel);
        }
        if (manager.getNotificationChannel(FALLBACK_CHANNEL_ID) == null) {
            NotificationChannel channel = new NotificationChannel(
                    FALLBACK_CHANNEL_ID,
                    context.getString(R.string.alarm_fallback_channel_name),
                    NotificationManager.IMPORTANCE_HIGH);
            channel.setSound(
                    Uri.parse("android.resource://" + context.getPackageName() + "/" + R.raw.alarm),
                    new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ALARM)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build());
            channel.enableVibration(true);
            channel.setVibrationPattern(VIBRATE_PATTERN);
            manager.createNotificationChannel(channel);
        }
    }

    static Intent ringIntent(Context context, @Nullable String alarmId) {
        Intent intent = new Intent(context, AlarmForegroundService.class);
        intent.setAction(ACTION_RING);
        if (alarmId != null) intent.putExtra(EXTRA_ALARM_ID, alarmId);
        return intent;
    }

    static Intent stopIntent(Context context, @Nullable String alarmId) {
        Intent intent = new Intent(context, AlarmForegroundService.class);
        intent.setAction(ACTION_STOP);
        if (alarmId != null) intent.putExtra(EXTRA_ALARM_ID, alarmId);
        return intent;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        autoClearHandler.removeCallbacks(autoClear);
        stopPlayerAndVibrator();
        ringing = false;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
