/**
 * Defines, per table, how sync is scoped by role and how ownership is
 * checked on push. This is the one place to touch when a new syncable
 * table is added.
 *
 * `pullWhere(user)` -> { clause: 'sql fragment using named params', params: {...} }
 *   The fragment is ANDed with `updated_at > @since`.
 *
 * `canWrite(user, record)` -> boolean. Called before applying a pushed
 *   create/update/delete, using the record as sent by the client.
 */

const READ_ONLY_ROLES = new Set(); // no roles are sync-read-only anymore now that marketer isn't a separate role

const SYNC_TABLES = {
  users: {
    pullWhere(user) {
      if (user.role === 'super_admin') return { clause: '1=1', params: {} };
      if (user.role === 'school_admin') return { clause: 'school_id = @schoolId', params: { schoolId: user.school_id } };
      return { clause: 'id = @userId', params: { userId: user.id } };
    },
    canWrite(user, record) {
      // Users update their own profile only; role/school/password changes go through dedicated admin endpoints.
      return record.id === user.id;
    },
    writableFields: ['full_name', 'email', 'phone'],
  },

  children: {
    pullWhere(user) {
      if (user.role === 'super_admin') return { clause: '1=1', params: {} };
      if (user.role === 'school_admin') return { clause: 'school_id = @schoolId', params: { schoolId: user.school_id } };
      if (user.role === 'parent') return { clause: 'parent_id = @userId', params: { userId: user.id } };
      return { clause: '1=0', params: {} }; // tutors/marketers don't sync children
    },
    canWrite(user, record) {
      if (user.role === 'super_admin') return true;
      if (user.role === 'parent') return record.parent_id === user.id;
      if (user.role === 'school_admin') return record.school_id === user.school_id;
      return false;
    },
    writableFields: ['parent_id', 'school_id', 'full_name', 'grade_level'],
  },

  tutor_profiles: {
    pullWhere(user) {
      // Public-ish: everyone can browse tutor profiles (needed for the Discover feed).
      return { clause: '1=1', params: {} };
    },
    canWrite(user, record) {
      if (user.role === 'super_admin') return true;
      return user.role === 'tutor' && record.user_id === user.id;
    },
    writableFields: ['subjects', 'qualifications', 'hourly_rate', 'currency', 'bio'],
  },

  bookings: {
    pullWhere(user) {
      if (user.role === 'super_admin') return { clause: '1=1', params: {} };
      if (user.role === 'parent') return { clause: 'parent_id = @userId', params: { userId: user.id } };
      if (user.role === 'tutor') return { clause: 'tutor_id = @userId', params: { userId: user.id } };
      return { clause: '1=0', params: {} };
    },
    canWrite(user, record) {
      if (user.role === 'super_admin') return true;
      if (user.role === 'parent') return record.parent_id === user.id;
      if (user.role === 'tutor') return record.tutor_id === user.id;
      return false;
    },
    writableFields: ['parent_id', 'tutor_id', 'child_id', 'subject', 'scheduled_at', 'status'],
  },

  auditions: {
    pullWhere(user) {
      if (user.role === 'super_admin') return { clause: '1=1', params: {} };
      if (user.role === 'parent') return { clause: 'parent_id = @userId', params: { userId: user.id } };
      if (user.role === 'tutor') return { clause: 'tutor_id = @userId', params: { userId: user.id } };
      return { clause: '1=0', params: {} };
    },
    canWrite(user, record) {
      if (user.role === 'super_admin') return true;
      if (user.role === 'parent') return record.parent_id === user.id;
      if (user.role === 'tutor') return record.tutor_id === user.id;
      return false;
    },
    writableFields: ['parent_id', 'tutor_id', 'status', 'video_url'],
  },

  schools: {
    pullWhere(user) {
      if (user.role === 'super_admin') return { clause: '1=1', params: {} };
      if (user.role === 'school_admin') return { clause: 'id = @schoolId', params: { schoolId: user.school_id } };
      if (user.school_id) return { clause: 'id = @schoolId', params: { schoolId: user.school_id } };
      return { clause: '1=0', params: {} };
    },
    canWrite(user, record) {
      if (user.role === 'super_admin') return true;
      return user.role === 'school_admin' && record.id === user.school_id;
    },
    writableFields: ['name', 'address', 'contact_email', 'contact_phone'],
  },

  referrals: {
    pullWhere(user) {
      if (user.role === 'super_admin') return { clause: '1=1', params: {} };
      return { clause: 'marketer_user_id = @userId OR new_user_id = @userId', params: { userId: user.id } };
    },
    canWrite() {
      return false; // referrals are server-generated only (at signup) / admin-managed
    },
    writableFields: [],
  },
};

module.exports = { SYNC_TABLES, READ_ONLY_ROLES };
