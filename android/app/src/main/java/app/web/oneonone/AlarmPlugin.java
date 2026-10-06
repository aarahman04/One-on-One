package app.web.oneonone;

import android.app.NotificationManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Bridges features/alarmNative.ts to the native alarm ring: JS must be able to
// stop it (ack, cancel, auto-clear), know it is ringing (so it doesn't ring a
// second time), and tell native when the chat page is the active surface.
@CapacitorPlugin(name = "Alarm")
public class AlarmPlugin extends Plugin {

    @PluginMethod
    public void stop(PluginCall call) {
        String alarmId = call.getString("alarmId");
        try {
            getContext().startService(AlarmForegroundService.stopIntent(getContext(), alarmId));
        } catch (IllegalStateException e) {
            /* background-start restriction — not ringing then */
        }
        MainActivity.clearShowOverLock(getActivity());
        call.resolve();
    }

    @PluginMethod
    public void isRinging(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ringing", AlarmForegroundService.ringing);
        ret.put("alarmId", AlarmForegroundService.ringingAlarmId);
        ret.put("lastStoppedAlarmId", AlarmForegroundService.lastStoppedAlarmId);
        call.resolve(ret);
    }

    @PluginMethod
    public void setChatActive(PluginCall call) {
        AppState.chatActive = Boolean.TRUE.equals(call.getBoolean("active", false));
        call.resolve();
    }

    // Android 14+ can revoke the full-screen-intent permission; without it the
    // lock-screen takeover silently degrades to a heads-up notification.
    @PluginMethod
    public void canUseFullScreenIntent(PluginCall call) {
        boolean can = true;
        if (Build.VERSION.SDK_INT >= 34) {
            NotificationManager nm = getContext().getSystemService(NotificationManager.class);
            can = nm == null || nm.canUseFullScreenIntent();
        }
        JSObject ret = new JSObject();
        ret.put("value", can);
        call.resolve(ret);
    }

    @PluginMethod
    public void openFullScreenIntentSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 34) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                getContext().startActivity(intent);
            } catch (Exception e) {
                /* settings screen missing on this OEM — ignore */
            }
        }
        call.resolve();
    }
}
