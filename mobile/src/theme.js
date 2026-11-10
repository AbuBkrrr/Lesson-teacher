import { StyleSheet } from 'react-native';

// Matches the web portal's CSS custom properties (src/styles/index.css) so
// the two apps read as the same product, not a reskin.
export const colors = {
  background: '#f0f2f5',
  text: '#1a1a2e',
  muted: '#5b6270',
  border: '#e5e7eb',
  card: '#ffffff',

  primary: '#6c5ce7',
  primaryHover: '#5a4bd1',
  primaryTint: '#faf8ff',

  successBg: '#d1fae5',
  successFg: '#065f46',
  warningBg: '#fef3c7',
  warningFg: '#b45309',
  dangerBg: '#fee2e2',
  dangerFg: '#991b1b',
  danger: '#dc2626',
  infoBg: '#e0e7ff',
  infoFg: '#3730a3',
};

export const radius = { sm: 8, md: 12, lg: 16 };

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };

export const typography = { h1: 26, h2: 20, body: 15, small: 13 };

export const commonStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screenContent: {
    padding: spacing.md,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  field: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: typography.small,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: typography.body,
    backgroundColor: colors.card,
    color: colors.text,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: typography.body,
  },
  secondaryButton: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: colors.text,
    fontWeight: '600',
  },
  dangerButton: {
    backgroundColor: colors.danger,
    borderRadius: radius.sm,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerButtonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  errorBanner: {
    backgroundColor: colors.dangerBg,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  errorBannerText: {
    color: colors.dangerFg,
    fontSize: typography.small,
  },
  emptyState: {
    padding: spacing.lg,
    alignItems: 'center',
  },
  emptyStateText: {
    color: colors.muted,
    fontSize: typography.body,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontSize: typography.small,
    fontWeight: '700',
  },
});

const BADGE_VARIANTS = {
  success: { bg: colors.successBg, fg: colors.successFg },
  warning: { bg: colors.warningBg, fg: colors.warningFg },
  danger: { bg: colors.dangerBg, fg: colors.dangerFg },
  info: { bg: colors.infoBg, fg: colors.infoFg },
  muted: { bg: colors.border, fg: colors.muted },
};

const STATUS_VARIANT = {
  active: 'success', confirmed: 'success', completed: 'success', successful: 'success', approved: 'success',
  pending: 'warning', awaiting_confirmation: 'warning',
  suspended: 'danger', cancelled: 'danger', declined: 'danger', failed: 'danger',
  unresolved: 'info',
};

export function badgeVariantForStatus(status) {
  return BADGE_VARIANTS[STATUS_VARIANT[status] || 'muted'];
}
