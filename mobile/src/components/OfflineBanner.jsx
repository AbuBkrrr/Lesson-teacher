import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { onOfflineEvent, outboxCount, startOutboxWorker } from '../utils/offline';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing } from '../theme';

/** Thin strip shown while requests are failing or messages are waiting to send. */
export default function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const [offline, setOffline] = useState(false);
  const [queued, setQueued] = useState(0);
  useEffect(() => {
    outboxCount().then(setQueued);
    const off = onOfflineEvent((e) => {
      if (e.type === 'network') setOffline(!e.ok);
      if (e.type === 'stale') setOffline(true);
      if (e.type === 'outbox') setQueued(e.count);
    });
    const stop = startOutboxWorker();
    return () => { off(); stop(); };
  }, []);
  if (!offline && queued === 0) return null;
  return (
    <View accessibilityRole="alert" style={{ backgroundColor: '#eef2ff', paddingTop: insets.top + 6, paddingBottom: 6, paddingHorizontal: spacing.md }}>
      <Text style={{ color: '#312e81', fontSize: 12 }}>
        {offline ? "You're offline. Showing saved information, which may be out of date." : 'Reconnected.'}
        {queued > 0 ? ` ${queued} message${queued === 1 ? '' : 's'} will send when you're back online.` : ''}
      </Text>
    </View>
  );
}
