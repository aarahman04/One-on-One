package app.web.oneonone;

import android.Manifest;
import android.content.Intent;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

// Bridges the call controller (controller.ts) to CallForegroundService. Both
// methods are idempotent: start twice just updates the running notification,
// stop with nothing running is a no-op that Android absorbs.
@CapacitorPlugin(
        name = "CallService",
        permissions = {
                @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications")
        }
)
public class CallServicePlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33
                && getPermissionState("notifications") != PermissionState.GRANTED) {
            // Ask once; a call notification is more useful with it, but the
            // service must start either way.
            requestPermissionForAlias("notifications", call, "notificationsCallback");
            return;
        }
        startService(call);
    }

    @PermissionCallback
    private void notificationsCallback(PluginCall call) {
        // Denial is non-fatal — start the service regardless.
        startService(call);
    }

    private void startService(PluginCall call) {
        String kind = call.getString("kind", "audio");
        Intent intent = new Intent(getContext(), CallForegroundService.class);
        intent.putExtra(CallForegroundService.EXTRA_KIND, kind);
        ContextCompat.startForegroundService(getContext(), intent);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().startService(CallForegroundService.stopIntent(getContext()));
        call.resolve();
    }
}
