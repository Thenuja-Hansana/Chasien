import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import TabBar from '@/components/TabBar';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';

// Posting for real (media upload, DB write) is Phase 5. Caption is
// local-only here and Post is disabled until that lands.
export default function CreatePost() {
  const { session } = useAuth();
  const { communityId } = useLocalSearchParams<{ communityId: string }>();
  const [caption, setCaption] = useState('');

  if (!session) return null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.headerAction}>Cancel</Text>
        </Pressable>
        <Text style={styles.headingText}>New post</Text>
        <Text style={[styles.headerAction, styles.headerActionDisabled]}>Post</Text>
      </View>

      <View style={styles.content}>
        <TextInput
          style={styles.caption}
          value={caption}
          onChangeText={setCaption}
          placeholder="Say something..."
          placeholderTextColor={Colors.neutral[500]}
          multiline
        />
        <Text style={styles.footerNote}>Posting for real arrives in Phase 5.</Text>
      </View>

      <TabBar active="Post" communityId={communityId} userId={session.user.id} />
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
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[3],
    paddingBottom: Spacing[4],
  },
  headingText: {
    fontFamily: Fonts?.heading,
    fontSize: 16,
    color: Colors.text,
  },
  headerAction: {
    fontFamily: Fonts?.body,
    fontSize: 14,
    fontWeight: '700',
    color: Colors.accent.DEFAULT,
  },
  headerActionDisabled: {
    opacity: 0.35,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing[6],
    gap: Spacing[3],
  },
  caption: {
    minHeight: 120,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.divider,
    padding: Spacing[4],
    fontSize: 15,
    color: Colors.text,
    fontFamily: Fonts?.body,
    textAlignVertical: 'top',
  },
  footerNote: {
    fontFamily: Fonts?.body,
    fontSize: 12,
    color: Colors.neutral[500],
    textAlign: 'center',
  },
});
