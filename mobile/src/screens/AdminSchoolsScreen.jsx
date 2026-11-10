import React, { useEffect, useState } from 'react';
import { View, Text, FlatList } from 'react-native';
import { admin } from '../api/client';
import { commonStyles, spacing, typography, colors } from '../theme';

export default function AdminSchoolsScreen() {
  const [schools, setSchools] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    admin.listSchools().then((d) => setSchools(d.schools)).catch((e) => setError(e.message));
  }, []);

  return (
    <View style={commonStyles.screen}>
      <FlatList
        data={schools}
        keyExtractor={(s) => s.id}
        contentContainerStyle={commonStyles.screenContent}
        ListHeaderComponent={
          <>
            <Text style={{ fontSize: 20, fontWeight: '800', marginBottom: spacing.xs }}>Schools</Text>
            <Text style={{ color: '#6b7280', marginBottom: spacing.md }}>Every school registered on the platform.</Text>
            {error && <View style={commonStyles.errorBanner}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}
          </>
        }
        ListEmptyComponent={<View style={commonStyles.emptyState}><Text style={commonStyles.emptyStateText}>No schools yet.</Text></View>}
        renderItem={({ item: s }) => (
          <View style={commonStyles.card}>
            <Text style={{ fontWeight: '700' }}>{s.name}</Text>
            <Text style={{ fontSize: typography.small, color: colors.muted, marginTop: 2 }}>{s.address || '—'}</Text>
            <Text style={{ fontSize: typography.small, color: colors.muted }}>{s.contact_email || s.contact_phone || '—'}</Text>
            <Text style={{ fontSize: typography.small, color: colors.muted }}>Join code: {s.join_code}</Text>
            <Text style={{ fontSize: typography.small, color: colors.muted }}>Status: {s.status}</Text>
          </View>
        )}
      />
    </View>
  );
}
