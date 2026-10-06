package app.web.oneonone;

import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginHandle;
import ee.forgr.capacitor.social.login.GoogleProvider;
import ee.forgr.capacitor.social.login.ModifiedMainActivityForSocialLoginPlugin;
import ee.forgr.capacitor.social.login.SocialLoginPlugin;

// The social-login plugin launches Google's scope-consent screen with
// Activity.startIntentSenderForResult, bypassing the Capacitor bridge, so the
// bridge cannot route the result back. Without this forward the plugin's
// internal future never completes and login() hangs after consent.
public class MainActivity extends BridgeActivity implements ModifiedMainActivityForSocialLoginPlugin {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CallServicePlugin.class);
        registerPlugin(AlarmPlugin.class);
        super.onCreate(savedInstanceState);
        handleAlarmIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleAlarmIntent(intent);
    }

    // Launched from the alarm notification: a tap (SILENCE) stops the ring and
    // opens the chat; the full-screen intent (SHOW) keeps ringing but lets the
    // activity appear over the lock screen and wake the display.
    private void handleAlarmIntent(Intent intent) {
        if (intent == null) return;
        boolean silence = intent.getBooleanExtra(AlarmForegroundService.EXTRA_SILENCE, false);
        boolean show = intent.getBooleanExtra(AlarmForegroundService.EXTRA_SHOW, false);
        if (silence) {
            try {
                startService(AlarmForegroundService.stopIntent(this, intent.getStringExtra(AlarmForegroundService.EXTRA_ALARM_ID)));
            } catch (IllegalStateException e) {
                /* ignore */
            }
            intent.removeExtra(AlarmForegroundService.EXTRA_SILENCE); // don't re-silence on a later recreate
            clearShowOverLock(this);
        } else if (show && Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }
    }

    static void clearShowOverLock(Activity activity) {
        if (activity == null || Build.VERSION.SDK_INT < 27) return;
        activity.runOnUiThread(() -> {
            activity.setShowWhenLocked(false);
            activity.setTurnScreenOn(false);
        });
    }

    @Override
    public void onResume() {
        super.onResume();
        AppState.foreground = true;
    }

    @Override
    public void onPause() {
        super.onPause();
        AppState.foreground = false;
    }

    @Override
    public void onStop() {
        super.onStop();
        // Alarm is over (or the user left): stop forcing the screen on/over the lock.
        if (!AlarmForegroundService.ringing) clearShowOverLock(this);
    }

    @Override
    public void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode >= GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MIN && requestCode < GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MAX) {
            PluginHandle handle = getBridge().getPlugin("SocialLogin");
            if (handle == null) return;
            Plugin plugin = handle.getInstance();
            if (plugin instanceof SocialLoginPlugin) {
                ((SocialLoginPlugin) plugin).handleGoogleLoginIntent(requestCode, data);
            }
        }
    }

    @Override
    public void IHaveModifiedTheMainActivityForTheUseWithSocialLoginPlugin() {}
}
