import React from 'react';
import { View, Text } from 'react-native';
import { commonStyles, badgeVariantForStatus } from '../theme';

export default function StatusBadge({ status }) {
  const variant = badgeVariantForStatus(status);
  return (
    <View style={[commonStyles.badge, { backgroundColor: variant.bg }]}>
      <Text style={[commonStyles.badgeText, { color: variant.fg }]}>{(status || '').replace(/_/g, ' ')}</Text>
    </View>
  );
}
