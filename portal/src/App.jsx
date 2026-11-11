import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';

import Login from './pages/Login';
import Signup from './pages/Signup';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import VerifyEmail from './pages/VerifyEmail';
import Verification from './pages/Verification';
import SuperAdminVerifications from './pages/superadmin/Verifications';
import PostSearch from './pages/parent/PostSearch';
import BrowseRequests from './pages/tutor/BrowseRequests';
import MyReferrals from './pages/MyReferrals';
import Bookings from './pages/Bookings';
import Auditions from './pages/Auditions';
import Messages from './pages/Messages';
import Account from './pages/Account';
import SuperAdminAuditLog from './pages/superadmin/AuditLog';
import Curriculum from './pages/Curriculum';
import StudentAssignments from './pages/StudentAssignments';
import StudentMaterials from './pages/StudentMaterials';
import ChildBadges from './pages/ChildBadges';
import LessonRoom from './pages/LessonRoom';

import SuperAdminDashboard from './pages/superadmin/Dashboard';
import SuperAdminUsers from './pages/superadmin/Users';
import SuperAdminSchools from './pages/superadmin/Schools';
import SuperAdminReferrals from './pages/superadmin/Referrals';
import SuperAdminSkills from './pages/superadmin/Skills';
import SuperAdminPayouts from './pages/superadmin/Payouts';
import SuperAdminSettings from './pages/superadmin/Settings';
import SuperAdminBookings from './pages/superadmin/Bookings';
import SuperAdminPayments from './pages/superadmin/Payments';
import SuperAdminRefunds from './pages/superadmin/Refunds';
import SuperAdminTutors from './pages/superadmin/Tutors';
import SuperAdminAnnouncements from './pages/superadmin/Announcements';

import SchoolProfile from './pages/school/Profile';
import SchoolStudents from './pages/school/Students';

import TutorProfile from './pages/tutor/Profile';
import TutorSkills from './pages/tutor/Skills';
import TutorAvailability from './pages/tutor/Availability';
import TutorEarnings from './pages/tutor/Earnings';
import TutorMaterials from './pages/tutor/Materials';
import TutorAssignments from './pages/tutor/Assignments';

import FindTutor from './pages/parent/FindTutor';
import SavedTutors from './pages/parent/SavedTutors';
import SwipeDiscover from './pages/parent/SwipeDiscover';
import ParentHome from './pages/parent/Home';
import MyChildren from './pages/parent/MyChildren';
import Subscriptions from './pages/Subscriptions';
import Notifications from './pages/Notifications';
import Monitor from './pages/parent/Monitor';

function RequireRole({ role, children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  const allowed = Array.isArray(role) ? role.includes(user.role) : user.role === role;
  if (!allowed) return <Navigate to="/" replace />; // signed in but wrong role: send them to their own home
  return children;
}

function RoleRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  const home = { super_admin: '/superadmin', school_admin: '/school', tutor: '/tutor', parent: '/parent', adult_student: '/parent', child: '/assignments' }[user.role];
  return <Navigate to={home || '/login'} replace />;
}

function Routed() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/" element={<RoleRedirect />} />

      {/* Shared across multiple roles */}
      <Route path="/messages" element={<RequireRole role={['tutor', 'parent', 'adult_student', 'child']}><Messages /></RequireRole>} />
      <Route path="/notifications" element={<RequireRole role={['super_admin', 'school_admin', 'tutor', 'parent', 'adult_student', 'child']}><Notifications /></RequireRole>} />
      <Route path="/account" element={<RequireRole role={['super_admin', 'school_admin', 'tutor', 'parent', 'adult_student', 'child']}><Account /></RequireRole>} />
      <Route path="/lessons/:bookingId" element={<RequireRole role={['tutor', 'parent', 'adult_student', 'child']}><LessonRoom /></RequireRole>} />
      <Route path="/curriculum" element={<RequireRole role={['super_admin', 'school_admin', 'tutor', 'parent', 'adult_student', 'child']}><Curriculum /></RequireRole>} />
      <Route path="/assignments" element={<RequireRole role={['parent', 'adult_student', 'child']}><StudentAssignments /></RequireRole>} />
      <Route path="/my-badges" element={<RequireRole role="child"><ChildBadges /></RequireRole>} />
      <Route path="/materials" element={<RequireRole role={['parent', 'adult_student', 'child']}><StudentMaterials /></RequireRole>} />
      <Route path="/subscriptions" element={<RequireRole role={['parent', 'adult_student', 'school_admin', 'super_admin']}><Subscriptions /></RequireRole>} />
      <Route path="/verification" element={<RequireRole role={['parent', 'adult_student', 'tutor', 'school_admin']}><Verification /></RequireRole>} />

      {/* Super Admin */}
      <Route path="/superadmin" element={<RequireRole role="super_admin"><SuperAdminDashboard /></RequireRole>} />
      <Route path="/superadmin/audit-log" element={<RequireRole role="super_admin"><SuperAdminAuditLog /></RequireRole>} />
      <Route path="/superadmin/users" element={<RequireRole role="super_admin"><SuperAdminUsers /></RequireRole>} />
      <Route path="/superadmin/schools" element={<RequireRole role="super_admin"><SuperAdminSchools /></RequireRole>} />
      <Route path="/superadmin/skills" element={<RequireRole role="super_admin"><SuperAdminSkills /></RequireRole>} />
      <Route path="/superadmin/payouts" element={<RequireRole role="super_admin"><SuperAdminPayouts /></RequireRole>} />
      <Route path="/superadmin/referrals" element={<RequireRole role="super_admin"><SuperAdminReferrals /></RequireRole>} />
      <Route path="/superadmin/bookings" element={<RequireRole role="super_admin"><SuperAdminBookings /></RequireRole>} />
      <Route path="/superadmin/payments" element={<RequireRole role="super_admin"><SuperAdminPayments /></RequireRole>} />
      <Route path="/superadmin/refunds" element={<RequireRole role="super_admin"><SuperAdminRefunds /></RequireRole>} />
      <Route path="/superadmin/tutors" element={<RequireRole role="super_admin"><SuperAdminTutors /></RequireRole>} />
      <Route path="/superadmin/announcements" element={<RequireRole role="super_admin"><SuperAdminAnnouncements /></RequireRole>} />
      <Route path="/superadmin/settings" element={<RequireRole role="super_admin"><SuperAdminSettings /></RequireRole>} />
      <Route path="/superadmin/verifications" element={<RequireRole role="super_admin"><SuperAdminVerifications /></RequireRole>} />

      {/* School */}
      <Route path="/school" element={<RequireRole role="school_admin"><SchoolProfile /></RequireRole>} />
      <Route path="/school/students" element={<RequireRole role="school_admin"><SchoolStudents /></RequireRole>} />
      <Route path="/school/referrals" element={<RequireRole role="school_admin"><MyReferrals /></RequireRole>} />

      {/* Tutor */}
      <Route path="/tutor" element={<RequireRole role="tutor"><TutorProfile /></RequireRole>} />
      <Route path="/tutor/skills" element={<RequireRole role="tutor"><TutorSkills /></RequireRole>} />
      <Route path="/tutor/availability" element={<RequireRole role="tutor"><TutorAvailability /></RequireRole>} />
      <Route path="/tutor/bookings" element={<RequireRole role="tutor"><Bookings /></RequireRole>} />
      <Route path="/tutor/auditions" element={<RequireRole role="tutor"><Auditions /></RequireRole>} />
      <Route path="/tutor/materials" element={<RequireRole role="tutor"><TutorMaterials /></RequireRole>} />
      <Route path="/tutor/assignments" element={<RequireRole role="tutor"><TutorAssignments /></RequireRole>} />
      <Route path="/tutor/earnings" element={<RequireRole role="tutor"><TutorEarnings /></RequireRole>} />
      <Route path="/tutor/referrals" element={<RequireRole role="tutor"><MyReferrals /></RequireRole>} />
      <Route path="/tutor/requests" element={<RequireRole role="tutor"><BrowseRequests /></RequireRole>} />

      {/* Parent / adult student */}
      <Route path="/parent" element={<RequireRole role={['parent', 'adult_student']}><ParentHome /></RequireRole>} />
      <Route path="/parent/discover" element={<RequireRole role={['parent', 'adult_student']}><SwipeDiscover /></RequireRole>} />
      <Route path="/parent/browse" element={<RequireRole role={['parent', 'adult_student']}><FindTutor /></RequireRole>} />
      <Route path="/parent/saved" element={<RequireRole role={['parent', 'adult_student']}><SavedTutors /></RequireRole>} />
      <Route path="/parent/children" element={<RequireRole role="parent"><MyChildren /></RequireRole>} />
      <Route path="/parent/bookings" element={<RequireRole role={['parent', 'adult_student']}><Bookings /></RequireRole>} />
      <Route path="/parent/auditions" element={<RequireRole role={['parent', 'adult_student']}><Auditions /></RequireRole>} />
      <Route path="/parent/requests" element={<RequireRole role={['parent', 'adult_student']}><PostSearch /></RequireRole>} />
      <Route path="/parent/monitor" element={<RequireRole role="parent"><Monitor /></RequireRole>} />
      <Route path="/parent/referrals" element={<RequireRole role={['parent', 'adult_student']}><MyReferrals /></RequireRole>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routed />
      </HashRouter>
    </AuthProvider>
  );
}
