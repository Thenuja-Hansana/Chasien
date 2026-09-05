import { BlurTargetView } from 'expo-blur';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import SettingsDrawer from '@/components/SettingsDrawer';
import TabBar from '@/components/TabBar';
import { Fonts, MaxContentWidth, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useTabBarClearance } from '@/hooks/use-tab-bar-clearance';
import { useTheme } from '@/hooks/use-theme';
import { startDm } from '@/lib/chat';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

type ProfileRow = { id: string; handle: string; name: string; bio: string | null };

// Real profile data (handle, bio, Room memberships) needs a `profiles`
// fetch that's out of scope for Phase 3's shell — this renders the
// account's own auth identity, which is real. Sign out lives here since
// the mock has no equivalent screen for it (it never modeled real auth).
export default function Profile() {
  const { session, signOut } = useAuth();
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const clearance = useTabBarClearance();
  const blurTargetRef = useRef<View>(null);
  const [profile, setProfile] = useState<ProfileRow | null | 'loading'>('loading');
  const [messaging, setMessaging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setProfile('loading');
      (async () => {
        try {
          const { data, error: fetchError } = await supabase.from('profiles').select('id, handle, name, bio').eq('id', userId).maybeSingle();
          if (fetchError) throw fetchError;
          setProfile(data);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to load this profile.');
        }
      })();
    }, [userId]),
  );

  if (!session) return null;

  const isOwnProfile = userId === session.user.id;

  async function handleMessage() {
    if (!userId) return;
    setMessaging(true);
    setError(null);
    try {
      const conversationId = await startDm(userId);
      router.push({ pathname: '/chats/[chatId]', params: { chatId: conversationId } });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start that conversation.');
    } finally {
      setMessaging(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <BlurTargetView ref={blurTargetRef} style={styles.flex}>
      {isOwnProfile && (
        <View style={styles.header}>
          <Pressable hitSlop={8} onPress={() => setSettingsOpen(true)}>
            <Icon name="settings" size={22} color={colors.text} />
          </Pressable>
        </View>
      )}

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: clearance }]}>
        {profile === 'loading' ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.accent.DEFAULT} />
          </View>
        ) : (
          <View style={styles.identity}>
            <Avatar
              gradient={userId}
              letter={(isOwnProfile ? session.user.email : profile?.handle)?.charAt(0).toUpperCase() || '?'}
              size={72}
              ring
            />
            <Text style={styles.name}>{isOwnProfile ? (session.user.email ?? '') : (profile?.name ?? 'Unknown')}</Text>
            {profile && !isOwnProfile && <Text style={styles.handle}>@{profile.handle}</Text>}
            {profile?.bio && <Text style={styles.bio}>{profile.bio}</Text>}
          </View>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        {!isOwnProfile && profile && (
          <Pressable style={styles.messageButton} onPress={handleMessage} disabled={messaging}>
            {messaging ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.messageButtonText}>Message</Text>}
          </Pressable>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Rooms</Text>
          <Text style={styles.body}>You haven&apos;t joined any Rooms yet.</Text>
        </View>

        {isOwnProfile && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Account</Text>
            <Pressable style={styles.signOutButton} onPress={() => signOut()}>
              <Text style={styles.signOutText}>Log out</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
      </BlurTargetView>

      <TabBar active="You" userId={session.user.id} blurTarget={blurTargetRef} />

      {isOwnProfile && <SettingsDrawer visible={settingsOpen} onClose={() => setSettingsOpen(false)} />}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[3],
  },
  content: {
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[6],
    paddingBottom: Spacing[8],
    gap: Spacing[6],
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  loading: {
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identity: {
    alignItems: 'center',
    gap: Spacing[2],
  },
  name: {
    fontFamily: Fonts.heading,
    fontSize: 20,
    color: colors.text,
  },
  handle: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: colors.neutral[400],
  },
  bio: {
    fontFamily: Fonts.body,
    fontSize: 13.5,
    color: colors.neutral[400],
    textAlign: 'center',
    marginTop: Spacing[1],
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: colors.accent.DEFAULT,
    textAlign: 'center',
  },
  messageButton: {
    height: 46,
    borderRadius: Radius.pill,
    backgroundColor: colors.accent.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageButtonText: {
    fontFamily: Fonts.heading,
    fontSize: 15,
    color: colors.bg,
  },
  section: {
    gap: Spacing[3],
  },
  sectionLabel: {
    fontFamily: Fonts.body,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.neutral[500],
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: colors.neutral[400],
  },
  signOutButton: {
    height: 48,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutText: {
    fontFamily: Fonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
});
