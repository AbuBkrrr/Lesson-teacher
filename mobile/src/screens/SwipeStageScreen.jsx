import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, Dimensions, Linking } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withSpring, interpolate, runOnJS, Extrapolation,
} from 'react-native-reanimated';
import { tutors, auditions, bookings, children as childrenApi } from '../api/client';
import { colors, spacing, typography, radius, commonStyles } from '../theme';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SWIPE_THRESHOLD = 110;
const EXIT_DISTANCE = SCREEN_WIDTH * 1.4;

export default function SwipeStageScreen({ route, navigation }) {
  const { selectedSkillIds = [], city = '', online = '' } = route.params || {};

  const [pool, setPool] = useState([]);
  const [index, setIndex] = useState(0);
  const [myChildren, setMyChildren] = useState([]);
  const [error, setError] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [showDetail, setShowDetail] = useState(false);

  // The action buttons live outside SwipeCard (so they don't re-mount with
  // it), but need to trigger *that specific card instance's* exit
  // animation. The card registers its trigger function here on mount.
  const triggerRef = useRef(null);

  useEffect(() => {
    childrenApi.mine().then((d) => setMyChildren(d.children)).catch(() => {});

    // Same backend limitation as the web client: /api/tutors only filters
    // by one skill_id at a time, so multiple selected skills use just the
    // first. Documented there too — kept consistent rather than papered
    // over differently on each client.
    const locationParams = { city: city || undefined, online: online || undefined };
    const fetchPromise = selectedSkillIds.length > 0
      ? tutors.list({ skill_id: selectedSkillIds[0], page_size: 50, ...locationParams })
      : tutors.list({ page_size: 50, ...locationParams });

    fetchPromise.then((d) => setPool(d.tutors)).catch((e) => setError(e.message));
  }, [selectedSkillIds, city, online]);

  const current = pool[index];

  const goToNext = useCallback(() => {
    setShowDetail(false);
    setIndex((i) => i + 1);
    setTimeout(() => setFeedback(null), 2500);
  }, []);

  const handleSwipeRight = useCallback(async (tutor) => {
    try {
      await auditions.create({ tutor_id: tutor.user_id });
      setFeedback(`Audition requested with ${tutor.full_name}!`);
    } catch (err) {
      setFeedback(err.message);
    }
  }, []);

  async function saveCurrent() {
    if (!current) return;
    try {
      await tutors.addFavorite(current.user_id);
      setFeedback(`Saved ${current.full_name}.`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function requestBooking() {
    if (!current) return;
    try {
      await bookings.create({ tutor_id: current.user_id, child_id: myChildren[0]?.id });
      setFeedback(`Booking requested with ${current.full_name}!`);
    } catch (err) {
      setFeedback(err.message);
    }
  }

  return (
    <View style={commonStyles.screen}>
      <View style={[commonStyles.screenContent, { flex: 1 }]}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Discover tutors</Text>
          <Pressable onPress={() => navigation.goBack()}>
            <Text style={styles.backLink}>← Change skills</Text>
          </Pressable>
        </View>

        {error && <View style={commonStyles.errorBanner}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}
        {feedback && (
          <View style={styles.successBanner}><Text style={styles.successBannerText}>{feedback}</Text></View>
        )}

        {!current ? (
          <View style={[commonStyles.card, commonStyles.emptyState]}>
            <Text style={commonStyles.emptyStateText}>
              {pool.length === 0 ? 'No tutors match yet — check back soon.' : "That's everyone! Try different skills for more matches."}
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.stage}>
              <SwipeCard
                key={current.id}
                tutor={current}
                showDetail={showDetail}
                registerTrigger={(fn) => { triggerRef.current = fn; }}
                onSwiped={(direction) => {
                  if (direction === 'right') handleSwipeRight(current);
                  goToNext();
                }}
              />
            </View>

            <View style={styles.actionsRow}>
              <Pressable style={[styles.actionBtn, styles.actionBtnDislike]} onPress={() => triggerRef.current?.('left')}>
                <Text style={styles.actionBtnText}>✕</Text>
              </Pressable>
              <Pressable style={[styles.actionBtn, styles.actionBtnInfo]} onPress={() => setShowDetail((v) => !v)}>
                <Text style={styles.actionBtnText}>i</Text>
              </Pressable>
              <Pressable style={[styles.actionBtn, styles.actionBtnLike]} onPress={() => triggerRef.current?.('right')}>
                <Text style={styles.actionBtnText}>♥</Text>
              </Pressable>
            </View>

            <Pressable style={styles.bookDirectlyBtn} onPress={saveCurrent}>
              <Text style={commonStyles.secondaryButtonText}>☆ Save for later</Text>
            </Pressable>
            <Pressable style={styles.bookDirectlyBtn} onPress={requestBooking}>
              <Text style={commonStyles.secondaryButtonText}>Book directly instead</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

function SwipeCard({ tutor, showDetail, onSwiped, registerTrigger }) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  const finishSwipe = useCallback((direction) => {
    onSwiped(direction);
  }, [onSwiped]);

  useEffect(() => {
    registerTrigger((direction) => {
      const toX = direction === 'right' ? EXIT_DISTANCE : -EXIT_DISTANCE;
      translateX.value = withTiming(toX, { duration: 260 }, (finished) => {
        if (finished) runOnJS(finishSwipe)(direction);
      });
    });
    return () => registerTrigger(null);
  }, [finishSwipe, registerTrigger, translateX]);

  // Mutating a Reanimated shared value's `.value` inside a worklet is the
  // library's documented, intended API (see useSharedValue docs), not an
  // accidental mutation of a normal React value. This rule is part of the
  // newer React-Compiler-safety ruleset, which doesn't yet special-case
  // Reanimated's worklet semantics — the plugin's own README ships a
  // companion `react-hooks/incompatible-library` rule acknowledging this
  // exact class of exception exists.
  /* eslint-disable react-hooks/immutability */
  const pan = Gesture.Pan()
    .onUpdate((e) => {
      translateX.value = e.translationX;
      translateY.value = e.translationY;
    })
    .onEnd((e) => {
      if (e.translationX > SWIPE_THRESHOLD) {
        translateX.value = withTiming(EXIT_DISTANCE, { duration: 260 }, (finished) => {
          if (finished) runOnJS(finishSwipe)('right');
        });
      } else if (e.translationX < -SWIPE_THRESHOLD) {
        translateX.value = withTiming(-EXIT_DISTANCE, { duration: 260 }, (finished) => {
          if (finished) runOnJS(finishSwipe)('left');
        });
      } else {
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
      }
    });
  /* eslint-enable react-hooks/immutability */

  const cardStyle = useAnimatedStyle(() => {
    const rotate = interpolate(translateX.value, [-SCREEN_WIDTH, SCREEN_WIDTH], [-12, 12], Extrapolation.CLAMP);
    return {
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value },
        { rotate: `${rotate}deg` },
      ],
    };
  });

  const likeBadgeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [20, 100], [0, 1], Extrapolation.CLAMP),
  }));
  const nopeBadgeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [-100, -20], [1, 0], Extrapolation.CLAMP),
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.card, cardStyle]}>
        <Animated.View style={[styles.badge, styles.likeBadge, likeBadgeStyle]}>
          <Text style={styles.badgeLabelText}>INTERESTED</Text>
        </Animated.View>
        <Animated.View style={[styles.badge, styles.nopeBadge, nopeBadgeStyle]}>
          <Text style={styles.badgeLabelText}>PASS</Text>
        </Animated.View>

        <View style={styles.videoPlaceholder}>
          <Text style={styles.videoPlaceholderText}>{tutor.full_name?.[0] || '?'}</Text>
          {tutor.intro_video_url ? (
            <Pressable style={styles.watchBtn} onPress={() => Linking.openURL(tutor.intro_video_url)} accessibilityLabel={`Watch introduction video from ${tutor.full_name}`}>
              <Text style={styles.watchBtnText}>▶ Watch intro video</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.cardBody}>
          <View style={styles.nameRow}>
            <Text style={styles.tutorName}>{tutor.full_name}</Text>
            {tutor.rating > 0 && (
              <View style={styles.topRatedBadge}><Text style={styles.topRatedBadgeText}>★ Top rated</Text></View>
            )}
          </View>
          <Text style={styles.ratingText}>
            ★ {tutor.rating?.toFixed(1) || 'New'} <Text style={styles.mutedText}>({tutor.review_count || 0} reviews)</Text>
          </Text>
          <View style={styles.skillsRow}>
            {(tutor.skills || []).map((s) => (
              <View key={s.name} style={styles.skillTag}>
                <Text style={styles.skillTagText}>{s.icon} {s.name}</Text>
              </View>
            ))}
          </View>
          {showDetail && tutor.bio && <Text style={styles.bioText}>{tutor.bio}</Text>}
          <View style={styles.metaRow}>
            <Text style={styles.metaText}>{tutor.currency} {tutor.hourly_rate || '—'}/hr</Text>
            <Text style={styles.metaText}>{tutor.qualifications || 'Qualifications on request'}</Text>
          </View>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

const CARD_HEIGHT = 480;

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  title: { fontSize: typography.h1, fontWeight: '800', color: colors.text },
  backLink: { color: colors.primary, fontWeight: '600' },
  successBanner: { backgroundColor: colors.successBg, borderRadius: radius.sm, padding: spacing.sm, marginBottom: spacing.sm },
  successBannerText: { color: colors.successFg, fontSize: typography.small },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: {
    width: '100%', maxWidth: 380, height: CARD_HEIGHT,
    backgroundColor: colors.card, borderRadius: radius.lg, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  videoPlaceholder: { height: 220, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center' },
  watchBtn: { position: 'absolute', bottom: 12, backgroundColor: colors.primary, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999 },
  watchBtnText: { color: '#fff', fontWeight: '700' },
  videoPlaceholderText: { fontSize: 64, fontWeight: '800', color: colors.primary },
  cardBody: { padding: spacing.md, flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
  tutorName: { fontSize: typography.h2, fontWeight: '800', color: colors.text },
  topRatedBadge: { backgroundColor: colors.warningBg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  topRatedBadgeText: { color: colors.warningFg, fontSize: 11, fontWeight: '700' },
  ratingText: { marginTop: 4, color: colors.text, fontSize: typography.small },
  mutedText: { color: colors.muted },
  skillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  skillTag: { backgroundColor: colors.background, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  skillTagText: { fontSize: 12, color: colors.text },
  bioText: { marginTop: spacing.sm, fontSize: typography.small, color: colors.muted },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  metaText: { fontSize: typography.small, color: colors.muted },
  badge: {
    position: 'absolute', top: 24, zIndex: 10, borderWidth: 3, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 4,
  },
  likeBadge: { left: 20, borderColor: colors.successFg, transform: [{ rotate: '-15deg' }] },
  nopeBadge: { right: 20, borderColor: colors.dangerFg, transform: [{ rotate: '15deg' }] },
  badgeLabelText: { fontSize: 18, fontWeight: '800', color: colors.text },
  actionsRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.lg, paddingVertical: spacing.md },
  actionBtn: {
    width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.card, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 4,
  },
  actionBtnDislike: { borderWidth: 2, borderColor: colors.dangerFg },
  actionBtnInfo: { borderWidth: 2, borderColor: colors.border },
  actionBtnLike: { borderWidth: 2, borderColor: colors.successFg },
  actionBtnText: { fontSize: 22, fontWeight: '800', color: colors.text },
  bookDirectlyBtn: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: spacing.md },
});
