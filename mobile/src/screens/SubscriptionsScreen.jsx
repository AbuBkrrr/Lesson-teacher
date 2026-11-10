import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { subscriptions } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import { colors, spacing, typography, commonStyles } from '../theme';
import { confirmAction } from '../utils/confirm';

export default function SubscriptionsScreen() {
  const [plans, setPlans] = useState([]);
  const [mine, setMine] = useState([]);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    subscriptions.plans('parent').then((d) => setPlans(d.plans)).catch((e) => setError(e.message));
    subscriptions.mine().then((d) => setMine(d.subscriptions)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function handleSubscribe(planId) {
    setBusyId(planId);
    setError(null);
    try {
      const res = await subscriptions.subscribe(planId);
      if (res.authorization_url?.startsWith('mock://')) {
        await subscriptions.mockComplete(res.reference);
        load();
      } else {
        setError('Gateway checkout needs expo-web-browser wired up for a real payment provider.');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleCancel(id) {
    setError(null);
    try { await subscriptions.cancel(id); load(); } catch (e) { setError(e.message); }
  }

  return (
    <View style={commonStyles.screen}>
      <FlatList
        data={plans}
        keyExtractor={(p) => p.id}
        contentContainerStyle={commonStyles.screenContent}
        ListHeaderComponent={
          <>
            {error && <View style={commonStyles.errorBanner}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}
            {mine.length > 0 && (
              <View style={commonStyles.card}>
                <Text style={styles.title}>Your subscription</Text>
                {mine.map((s) => (
                  <View key={s.id} style={styles.mineRow}>
                    <Text style={styles.metaText}>{s.plan_name}</Text>
                    <StatusBadge status={s.status} />
                    {s.status === 'active' && (
                      <Pressable style={commonStyles.dangerButton} onPress={() => confirmAction('Cancel this plan?', 'You will lose its benefits.', () => handleCancel(s.id), 'Yes, cancel plan')}>
                        <Text style={commonStyles.dangerButtonText}>Cancel</Text>
                      </Pressable>
                    )}
                  </View>
                ))}
              </View>
            )}
          </>
        }
        ListEmptyComponent={
          <View style={commonStyles.emptyState}><Text style={commonStyles.emptyStateText}>No plans available yet.</Text></View>
        }
        renderItem={({ item: p }) => (
          <View style={commonStyles.card}>
            <Text style={styles.title}>{p.name}</Text>
            <Text style={styles.price}>{p.currency} {p.price.toLocaleString()}<Text style={styles.interval}>/{p.interval}</Text></Text>
            {(JSON.parse(p.benefits || '[]')).map((b) => <Text key={b} style={styles.metaText}>• {b}</Text>)}
            {p.booking_discount_percent > 0 && <Text style={styles.metaText}>• {p.booking_discount_percent}% off bookings</Text>}
            <Pressable style={[commonStyles.primaryButton, { marginTop: spacing.sm }]} disabled={busyId === p.id} onPress={() => handleSubscribe(p.id)}>
              <Text style={commonStyles.primaryButtonText}>{busyId === p.id ? 'Processing…' : 'Subscribe'}</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: typography.h2, fontWeight: '700', color: colors.text, marginBottom: spacing.xs },
  price: { fontSize: typography.h1, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  interval: { fontSize: typography.small, fontWeight: '400', color: colors.muted },
  metaText: { fontSize: typography.small, color: colors.muted, marginTop: 2 },
  mineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
});
