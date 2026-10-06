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
    // This activity is exported (launcher), so every extra is untrusted: nothing
    // happens unless the per-ring token our own service put in its
    // PendingIntents matches AND an alarm is actually live; the alarm id is
    // length-checked and must match the ringing alarm. None of this navigates:
    // the app still resolves its normal session/login screen.
    private void handleAlarmIntent(Intent intent) {
        if (intent == null) return;
        String token = intent.getStringExtra(AlarmForegroundService.EXTRA_TOKEN);
        boolean silence = intent.getBooleanExtra(AlarmForegroundService.EXTRA_SILENCE, false);
        boolean show = intent.getBooleanExtra(AlarmForegroundService.EXTRA_SHOW, false);
        // Strip regardless, so a recreate/re-delivery can't replay them.
        intent.removeExtra(AlarmForegroundService.EXTRA_SILENCE);
        intent.removeExtra(AlarmForegroundService.EXTRA_SHOW);
        intent.removeExtra(AlarmForegroundService.EXTRA_TOKEN);
        if (!(silence || show) || !AlarmForegroundService.tokenValid(token)) return;
        String alarmId = intent.getStringExtra(AlarmForegroundService.EXTRA_ALARM_ID);
        if (!AlarmForegroundService.alarmIdAcceptable(alarmId)) return;

        if (silence) {
            try {
                startService(AlarmForegroundService.stopIntent(this, alarmId));
            } catch (IllegalStateException e) {
                /* ignore */
            }
            clearShowOverLock(this);
        } else if (Build.VERSION.SDK_INT >= 27) {
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
