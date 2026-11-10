import React from 'react';

const VARIANT_BY_STATUS = {
  active: 'success',
  confirmed: 'success',
  converted: 'success',
  ready: 'success',
  completed: 'success',
  paid: 'success',
  approved: 'success',
  successful: 'success',
  denied: 'danger',
  failed: 'danger',
  refunded: 'muted',
  processing: 'info',

  pending: 'warning',
  awaiting_confirmation: 'warning',
  not_calculated: 'muted',

  suspended: 'danger',
  cancelled: 'danger',
  declined: 'danger',
  invalid: 'danger',

  unresolved: 'info',
};

export default function StatusBadge({ status }) {
  const variant = VARIANT_BY_STATUS[status] || 'muted';
  return <span className={`lt-badge lt-badge--${variant}`}>{status?.replace(/_/g, ' ')}</span>;
}
