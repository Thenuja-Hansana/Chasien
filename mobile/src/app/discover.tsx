import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import TabBar from '@/components/TabBar';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';

// Browsing/joining real Rooms is Phase 4 — this is the navigable shell:
// search still routes to /search, "Start a Room" still routes to
// /create-community, there's just no Room list to render yet.
export default function Discover() {
  const { session } = useAuth();
  const [query, setQuery] = useState('');

  if (!session) return null;

  function handleSearchSubmit() {
    router.push(`/search?q=${encodeURIComponent(query.trim())}`);
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.heading}>Find your Rooms</Text>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={handleSearchSubmit}
          placeholder="Search Rooms"
          placeholderTextColor={Colors.neutral[500]}
          returnKeyType="search"
        />
      </View>

      <View style={styles.empty}>
        <Text style={styles.emptyHeading}>No Rooms yet</Text>
        <Text style={styles.body}>Public Rooms will show up here once there are some to join.</Text>
        <Pressable style={styles.cta} onPress={() => router.push('/create-community')}>
          <Text style={styles.ctaText}>Start a Room</Text>
        </Pressable>
      </View>

      <TabBar active="Explore" userId={session.user.id} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  header: {
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[3],
    gap: Spacing[3],
  },
  heading: {
    fontFamily: Fonts?.heading,
    fontSize: 26,
    color: Colors.text,
  },
  input: {
    height: 48,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.divider,
    paddingHorizontal: 18,
    fontSize: 15,
    color: Colors.text,
    fontFamily: Fonts?.body,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[2],
    paddingHorizontal: Spacing[6],
  },
  emptyHeading: {
    fontFamily: Fonts?.heading,
    fontSize: 20,
    color: Colors.text,
  },
  body: {
    fontFamily: Fonts?.body,
    fontSize: 14,
    color: Colors.neutral[400],
    textAlign: 'center',
  },
  cta: {
    marginTop: Spacing[4],
    height: 44,
    paddingHorizontal: Spacing[6],
    borderRadius: Radius.pill,
    borderWidth: 1.5,
    borderColor: Colors.accent.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    fontFamily: Fonts?.heading,
    fontSize: 15,
    color: Colors.accent.DEFAULT,
  },
});
