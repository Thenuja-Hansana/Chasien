import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import TabBar from '@/components/TabBar';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';

// Real search (Rooms/people/posts) is Phase 4+ — this proves the route and
// the query-param handoff from Discover work end to end.
export default function Search() {
  const { session } = useAuth();
  const { q } = useLocalSearchParams<{ q?: string }>();
  const [query, setQuery] = useState(q ?? '');

  if (!session) return null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Search Rooms"
          placeholderTextColor={Colors.neutral[500]}
          autoFocus={!q}
          returnKeyType="search"
        />
        <Pressable onPress={() => router.back()}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
      </View>

      <View style={styles.empty}>
        <Text style={styles.body}>{query ? `No results for "${query}"` : 'Search for a Room by name.'}</Text>
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[3],
  },
  input: {
    flex: 1,
    height: 46,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.divider,
    paddingHorizontal: 18,
    fontSize: 15,
    color: Colors.text,
    fontFamily: Fonts?.body,
  },
  cancel: {
    fontFamily: Fonts?.body,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.neutral[400],
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing[6],
  },
  body: {
    fontFamily: Fonts?.body,
    fontSize: 14,
    color: Colors.neutral[400],
    textAlign: 'center',
  },
});
