import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, Text, Pressable, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuth } from '../contexts/AuthContext';
import { conversations } from '../api/client';
import { colors, spacing, typography, commonStyles } from '../theme';

import LoginScreen from '../screens/LoginScreen';
import SignupScreen from '../screens/SignupScreen';
import ForgotPasswordScreen from '../screens/ForgotPasswordScreen';
import DiscoverSkillsScreen from '../screens/DiscoverSkillsScreen';
import SwipeStageScreen from '../screens/SwipeStageScreen';
import BookingsScreen from '../screens/BookingsScreen';
import ConversationListScreen from '../screens/ConversationListScreen';
import ConversationThreadScreen from '../screens/ConversationThreadScreen';
import MyChildrenScreen from '../screens/MyChildrenScreen';
import AccountScreen from '../screens/AccountScreen';
import MonitorScreen from '../screens/MonitorScreen';
import LessonRoomScreen from '../screens/LessonRoomScreen';
import SubscriptionsScreen from '../screens/SubscriptionsScreen';
import LeaderboardScreen from '../screens/LeaderboardScreen';
import VerificationScreen from '../screens/VerificationScreen';
import PostSearchScreen from '../screens/PostSearchScreen';
import ReferralsScreen from '../screens/ReferralsScreen';
import CurriculumScreen from '../screens/CurriculumScreen';

import ChildAssignmentsScreen from '../screens/ChildAssignmentsScreen';
import ChildBadgesScreen from '../screens/ChildBadgesScreen';

import TutorProfileScreen from '../screens/TutorProfileScreen';
import TutorSkillsScreen from '../screens/TutorSkillsScreen';
import TutorEarningsScreen from '../screens/TutorEarningsScreen';
import TutorMaterialsScreen from '../screens/TutorMaterialsScreen';
import TutorAssignmentsScreen from '../screens/TutorAssignmentsScreen';
import TutorAuditionsScreen from '../screens/TutorAuditionsScreen';
import TutorAvailabilityScreen from '../screens/TutorAvailabilityScreen';
import SavedTutorsScreen from '../screens/SavedTutorsScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import LinkedDevicesScreen from '../screens/LinkedDevicesScreen';
import AdminAuditLogScreen from '../screens/AdminAuditLogScreen';
import TutorRequestsScreen from '../screens/TutorRequestsScreen';

import SchoolProfileScreen from '../screens/SchoolProfileScreen';
import SchoolStudentsScreen from '../screens/SchoolStudentsScreen';

import AdminDashboardScreen from '../screens/AdminDashboardScreen';
import AdminUsersScreen from '../screens/AdminUsersScreen';
import AdminSchoolsScreen from '../screens/AdminSchoolsScreen';
import AdminPayoutsScreen from '../screens/AdminPayoutsScreen';
import AdminBookingsScreen from '../screens/AdminBookingsScreen';
import AdminTutorsScreen from '../screens/AdminTutorsScreen';
import AdminPaymentsScreen from '../screens/AdminPaymentsScreen';
import AdminRefundsScreen from '../screens/AdminRefundsScreen';
import AdminAnnouncementsScreen from '../screens/AdminAnnouncementsScreen';
import AdminSettingsScreen from '../screens/AdminSettingsScreen';
import AdminVerificationsScreen from '../screens/AdminVerificationsScreen';

const RootStack = createNativeStackNavigator();
const AuthStack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();
const DiscoverStack = createNativeStackNavigator();
const MessagesStack = createNativeStackNavigator();
const AccountStack = createNativeStackNavigator();

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Signup" component={SignupScreen} />
      <AuthStack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
    </AuthStack.Navigator>
  );
}

function DiscoverNavigator() {
  return (
    <DiscoverStack.Navigator>
      <DiscoverStack.Screen name="DiscoverSkills" component={DiscoverSkillsScreen} options={{ title: 'Discover' }} />
      <DiscoverStack.Screen name="SwipeStage" component={SwipeStageScreen} options={{ headerShown: false }} />
    </DiscoverStack.Navigator>
  );
}

function MessagesNavigator() {
  return (
    <MessagesStack.Navigator>
      <MessagesStack.Screen name="ConversationList" component={ConversationListScreen} options={{ title: 'Messages' }} />
      <MessagesStack.Screen name="ConversationThread" component={ConversationThreadScreen} />
    </MessagesStack.Navigator>
  );
}

// A single, role-aware Account stack. Every screen any role might navigate
// to from AccountScreen is registered here; AccountScreen itself only shows
// the links relevant to the signed-in user's role (see LINKS_BY_ROLE there),
// so a given user only ever reaches the screens meant for them, even though
// the stack carries all of them.
function AccountNavigator() {
  return (
    <AccountStack.Navigator>
      <AccountStack.Screen name="AccountHome" component={AccountScreen} options={{ title: 'Account' }} />

      {/* Parent / adult_student */}
      <AccountStack.Screen name="SavedTutors" component={SavedTutorsScreen} options={{ title: 'Saved tutors' }} />
      <AccountStack.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Notifications' }} />
      <AccountStack.Screen name="LinkedDevices" component={LinkedDevicesScreen} options={{ title: 'Linked devices & backup' }} />
      <AccountStack.Screen name="MyChildren" component={MyChildrenScreen} options={{ title: 'My children' }} />
      <AccountStack.Screen name="Monitor" component={MonitorScreen} options={{ title: 'Monitor' }} />
      <AccountStack.Screen name="Leaderboard" component={LeaderboardScreen} options={{ title: 'Leaderboard' }} />
      <AccountStack.Screen name="Subscriptions" component={SubscriptionsScreen} options={{ title: 'Subscription' }} />
      <AccountStack.Screen name="Verification" component={VerificationScreen} options={{ title: 'ID verification' }} />
      <AccountStack.Screen name="PostSearch" component={PostSearchScreen} options={{ title: 'Post a search' }} />
      <AccountStack.Screen name="Referrals" component={ReferralsScreen} options={{ title: 'My referrals' }} />

      {/* Child */}
      <AccountStack.Screen name="ChildAssignments" component={ChildAssignmentsScreen} options={{ title: 'My assignments' }} />
      <AccountStack.Screen name="ChildBadges" component={ChildBadgesScreen} options={{ title: 'My badges' }} />

      {/* Tutor */}
      <AccountStack.Screen name="TutorProfile" component={TutorProfileScreen} options={{ title: 'My profile' }} />
      <AccountStack.Screen name="TutorSkills" component={TutorSkillsScreen} options={{ title: 'My skills' }} />
      <AccountStack.Screen name="TutorAvailability" component={TutorAvailabilityScreen} options={{ title: 'My availability' }} />
      <AccountStack.Screen name="TutorEarnings" component={TutorEarningsScreen} options={{ title: 'Earnings' }} />
      <AccountStack.Screen name="TutorMaterials" component={TutorMaterialsScreen} options={{ title: 'Lesson materials' }} />
      <AccountStack.Screen name="TutorAssignments" component={TutorAssignmentsScreen} options={{ title: 'Assignments' }} />

      {/* School admin */}
      <AccountStack.Screen name="SchoolProfile" component={SchoolProfileScreen} options={{ title: 'School profile' }} />
      <AccountStack.Screen name="SchoolStudents" component={SchoolStudentsScreen} options={{ title: 'Students' }} />

      {/* Super admin */}
      <AccountStack.Screen name="AdminDashboard" component={AdminDashboardScreen} options={{ title: 'Dashboard' }} />
      <AccountStack.Screen name="AdminUsers" component={AdminUsersScreen} options={{ title: 'Users' }} />
      <AccountStack.Screen name="AdminSchools" component={AdminSchoolsScreen} options={{ title: 'Schools' }} />
      <AccountStack.Screen name="AdminPayouts" component={AdminPayoutsScreen} options={{ title: 'Payouts' }} />
      <AccountStack.Screen name="AdminPayments" component={AdminPaymentsScreen} options={{ title: 'Payments' }} />
      <AccountStack.Screen name="AdminBookings" component={AdminBookingsScreen} options={{ title: 'Bookings' }} />
      <AccountStack.Screen name="AdminTutors" component={AdminTutorsScreen} options={{ title: 'Tutors' }} />
      <AccountStack.Screen name="AdminRefunds" component={AdminRefundsScreen} options={{ title: 'Refund requests' }} />
      <AccountStack.Screen name="AdminAnnouncements" component={AdminAnnouncementsScreen} options={{ title: 'Announcements' }} />
      <AccountStack.Screen name="AdminSettings" component={AdminSettingsScreen} options={{ title: 'Platform settings' }} />
      <AccountStack.Screen name="AdminAuditLog" component={AdminAuditLogScreen} options={{ title: 'Audit log' }} />
      <AccountStack.Screen name="AdminVerifications" component={AdminVerificationsScreen} options={{ title: 'Verifications' }} />

      {/* Shared */}
      <AccountStack.Screen name="Curriculum" component={CurriculumScreen} options={{ title: 'Curriculum' }} />
    </AccountStack.Navigator>
  );
}

// Polls the unread-message count so the Messages tab can show a badge.
function useUnreadCount() {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const poll = () => conversations.unreadCount().then((d) => { if (!cancelled) setUnread(d.unread); }).catch(() => {});
    poll();
    const t = setInterval(poll, 20000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);
  return unread > 0 ? unread : undefined;
}

function ParentTabs() {
  const unread = useUnreadCount();
  return (
    <Tabs.Navigator screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.primary }}>
      <Tabs.Screen name="Discover" component={DiscoverNavigator} />
      <Tabs.Screen name="Bookings" component={BookingsScreen} options={{ headerShown: true }} />
      <Tabs.Screen name="Messages" component={MessagesNavigator} options={{ tabBarBadge: unread }} />
      <Tabs.Screen name="Account" component={AccountNavigator} />
    </Tabs.Navigator>
  );
}

function ChildTabs() {
  const unread = useUnreadCount();
  return (
    <Tabs.Navigator screenOptions={{ headerShown: true, tabBarActiveTintColor: colors.primary }}>
      <Tabs.Screen name="Bookings" component={BookingsScreen} />
      <Tabs.Screen name="Messages" component={MessagesNavigator} options={{ headerShown: false, tabBarBadge: unread }} />
      <Tabs.Screen name="Account" component={AccountNavigator} options={{ headerShown: false }} />
    </Tabs.Navigator>
  );
}

function TutorTabs() {
  const unread = useUnreadCount();
  return (
    <Tabs.Navigator screenOptions={{ headerShown: true, tabBarActiveTintColor: colors.primary }}>
      <Tabs.Screen name="Bookings" component={BookingsScreen} />
      <Tabs.Screen name="Auditions" component={TutorAuditionsScreen} options={{ headerShown: false }} />
      <Tabs.Screen name="Requests" component={TutorRequestsScreen} options={{ headerShown: false }} />
      <Tabs.Screen name="Messages" component={MessagesNavigator} options={{ headerShown: false, tabBarBadge: unread }} />
      <Tabs.Screen name="Account" component={AccountNavigator} options={{ headerShown: false }} />
    </Tabs.Navigator>
  );
}

function SchoolAdminTabs() {
  return (
    <Tabs.Navigator screenOptions={{ headerShown: true, tabBarActiveTintColor: colors.primary }}>
      <Tabs.Screen name="Students" component={SchoolStudentsScreen} />
      <Tabs.Screen name="Curriculum" component={CurriculumScreen} options={{ headerShown: false }} />
      <Tabs.Screen name="Account" component={AccountNavigator} options={{ headerShown: false }} />
    </Tabs.Navigator>
  );
}

function SuperAdminTabs() {
  return (
    <Tabs.Navigator screenOptions={{ headerShown: true, tabBarActiveTintColor: colors.primary }}>
      <Tabs.Screen name="Dashboard" component={AdminDashboardScreen} />
      <Tabs.Screen name="Users" component={AdminUsersScreen} />
      <Tabs.Screen name="Verifications" component={AdminVerificationsScreen} />
      <Tabs.Screen name="Payouts" component={AdminPayoutsScreen} />
      <Tabs.Screen name="Account" component={AccountNavigator} options={{ headerShown: false }} />
    </Tabs.Navigator>
  );
}

const TABS_BY_ROLE = {
  parent: ParentTabs,
  adult_student: ParentTabs,
  child: ChildTabs,
  tutor: TutorTabs,
  school_admin: SchoolAdminTabs,
  super_admin: SuperAdminTabs,
};

function UnsupportedRoleScreen() {
  const { logout } = useAuth();
  return (
    <View style={[commonStyles.screen, styles.centered]}>
      <Text style={styles.unsupportedTitle}>Not available yet</Text>
      <Text style={styles.unsupportedText}>
        This app doesn’t have a mobile experience for this account type yet — use the web portal in the meantime.
      </Text>
      <Pressable style={[commonStyles.secondaryButton, { marginTop: spacing.md }]} onPress={logout}>
        <Text style={commonStyles.secondaryButtonText}>Log out</Text>
      </Pressable>
    </View>
  );
}

export default function RootNavigator() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const RoleTabs = user ? TABS_BY_ROLE[user.role] : null;

  return (
    <NavigationContainer>
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        {!user ? (
          <RootStack.Screen name="Auth" component={AuthNavigator} />
        ) : !RoleTabs ? (
          <RootStack.Screen name="Unsupported" component={UnsupportedRoleScreen} />
        ) : (
          <>
            <RootStack.Screen name="MainTabs" component={RoleTabs} />
            <RootStack.Screen
              name="LessonRoom"
              component={LessonRoomScreen}
              options={{ presentation: 'fullScreenModal', headerShown: false }}
            />
          </>
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  centered: { alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  unsupportedTitle: { fontSize: typography.h1, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  unsupportedText: { fontSize: typography.body, color: colors.muted, textAlign: 'center' },
});
