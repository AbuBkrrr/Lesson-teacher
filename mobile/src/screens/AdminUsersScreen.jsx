import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, TextInput } from 'react-native';
import { admin } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import { commonStyles, spacing, typography, colors } from '../theme';
import { confirmAction } from '../utils/confirm';

const ROLES = ['', 'parent', 'adult_student', 'child', 'tutor', 'school_admin', 'super_admin'];
const PAGE = 50;

export default function AdminUsersScreen() {
  const [users, setUsers] = useState([]);
  const [roleFilter, setRoleFilter] = useState('');
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyId, setBusyId] = useState(null);
  useEffect(() => { const t = setTimeout(() => setQ(query.trim()), 300); return () => clearTimeout(t); }, [query]);

  function load(n = 1) {
    return admin.listUsers({ page: n, page_size: PAGE, ...(roleFilter ? { role: roleFilter } : {}), ...(q ? { q } : {}) })
      .then((d) => { setUsers((prev) => (n === 1 ? d.users : [...prev, ...d.users])); setTotal(d.total); setPage(n); setError(null); })
      .catch((e) => setError(e.message));
  }
  useEffect(() => { load(1); }, [roleFilter, q]); // eslint-disable-line react-hooks/exhaustive-deps

  async function sendReset(u) {
    setBusyId(u.id);
    try { await admin.sendPasswordReset(u.id); setNotice(`Password reset link sent to ${u.full_name}.`); } catch (e) { setError(e.message); } finally { setBusyId(null); }
  }

  async function toggleStatus(user) {
    setBusyId(user.id);
    try {
      if (user.status === 'suspended') await admin.reactivateUser(user.id);
      else await admin.suspendUser(user.id);
      load(1);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <View style={commonStyles.screen}>
      <FlatList
        data={users}
        keyExtractor={(u) => u.id}
        contentContainerStyle={commonStyles.screenContent}
        ListHeaderComponent={
          <>
            <Text style={{ fontSize: 20, fontWeight: '800', marginBottom: spacing.xs }}>Users</Text>
            <Text style={{ color: '#6b7280', marginBottom: spacing.sm }}>Every account on the platform.</Text>
            {error && <View style={commonStyles.errorBanner}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}
            {notice && <View style={[commonStyles.errorBanner, { backgroundColor: '#d1fae5' }]}><Text style={[commonStyles.errorBannerText, { color: '#065f46' }]}>{notice}</Text></View>}
            <TextInput style={[commonStyles.input, { marginBottom: spacing.sm }]} placeholder="Search name, email, phone, code" accessibilityLabel="Search users" value={query} onChangeText={setQuery} autoCapitalize="none" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md }}>
              {ROLES.map((r) => (
                <Pressable
                  key={r || 'all'}
                  style={[commonStyles.secondaryButton, { paddingVertical: 6, paddingHorizontal: spacing.sm }, roleFilter === r && { backgroundColor: colors.primaryTint, borderColor: colors.primary }]}
                  onPress={() => setRoleFilter(r)}
                >
                  <Text style={commonStyles.secondaryButtonText}>{r || 'All roles'}</Text>
                </Pressable>
              ))}
            </View>
          </>
        }
        onEndReached={() => { if (users.length < total) load(page + 1); }}
        ListEmptyComponent={<View style={commonStyles.emptyState}><Text style={commonStyles.emptyStateText}>No users match this filter.</Text></View>}
        renderItem={({ item: u }) => (
          <View style={commonStyles.card}>
            <View style={styles.rowBetween}>
              <Text style={{ fontWeight: '700' }}>{u.full_name}</Text>
              <StatusBadge status={u.status} />
            </View>
            <Text style={{ fontSize: typography.small, color: colors.muted, marginTop: 2 }}>{u.role}</Text>
            <Text style={{ fontSize: typography.small, color: colors.muted }}>{u.email || u.phone || '—'}</Text>
            <Text style={{ fontSize: typography.small, color: colors.muted }}>Referral code: {u.referral_code}</Text>
            {u.role !== 'super_admin' && u.email && (
              <Pressable style={[commonStyles.secondaryButton, { marginTop: spacing.sm, alignSelf: 'flex-start' }]} disabled={busyId === u.id} onPress={() => sendReset(u)} accessibilityLabel={`Send ${u.full_name} a password reset link`}>
                <Text style={commonStyles.secondaryButtonText}>Send reset link</Text>
              </Pressable>
            )}
            {u.role !== 'super_admin' && (
              <Pressable
                style={[u.status === 'suspended' ? commonStyles.secondaryButton : commonStyles.dangerButton, { marginTop: spacing.sm, alignSelf: 'flex-start' }]}
                disabled={busyId === u.id}
                onPress={() => (u.status === 'suspended' ? toggleStatus(u) : confirmAction('Suspend this user?', `${u.full_name} will be signed out immediately.`, () => toggleStatus(u), 'Yes, suspend'))}
              >
                <Text style={u.status === 'suspended' ? commonStyles.secondaryButtonText : commonStyles.dangerButtonText}>
                  {u.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                </Text>
              </Pressable>
            )}
          </View>
        )}
      />
    </View>
  );
}

const styles = {
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
};
