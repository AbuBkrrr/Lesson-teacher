// Registers this device for push notifications and syncs the token with
// the backend (see POST/DELETE /api/push-tokens). Uses the raw platform
// device token (APNs on iOS, FCM on Android/web), not an Expo push token
// — the backend's fcmProvider sends directly through firebase-admin,
// which expects that raw token, not an "ExponentPushToken[...]" string.
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { pushTokens } from './api/client';

let lastRegisteredToken = null;

/** Call once after a successful login/signup (and on cold start if already signed in). */
export async function registerForPushNotifications() {
  try {
    if (!Device.isDevice) return; // simulators/emulators don't have real push tokens
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return;

    const { data: token } = await Notifications.getDevicePushTokenAsync();
    if (!token) return;

    lastRegisteredToken = token;
    await pushTokens.register(token, Platform.OS);
  } catch {
    // Push registration is a nice-to-have, never block sign-in on it.
  }
}

/** Call on logout so a signed-out device stops receiving push for that user. */
export async function unregisterPushNotifications() {
  if (!lastRegisteredToken) return;
  try {
    await pushTokens.unregister(lastRegisteredToken);
  } catch {
    // Best-effort — the token row will just go stale server-side otherwise.
  } finally {
    lastRegisteredToken = null;
  }
}
