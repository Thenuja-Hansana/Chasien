import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { pickImageOrVideo, type PickedMedia } from '@/lib/media';
import { fetchRoomBySlug, type Room } from '@/lib/rooms';
import { createStory } from '@/lib/stories';

/** Mirrors create-post.tsx's structure, simplified: one required media item, optional caption, no poll. */
export default function CreateStory() {
  const { session } = useAuth();
  const { communityId } = useLocalSearchParams<{ communityId: string }>();

  const [room, setRoom] = useState<Room | null>(null);
  const [media, setMedia] = useState<PickedMedia | null>(null);
  const [caption, setCaption] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const userId = session?.user.id;

  useEffect(() => {
    fetchRoomBySlug(communityId)
      .then((r) => {
        setRoom(r);
        // Open the picker immediately — a story is nothing without media,
        // unlike a post, so there's no reason to show an empty composer first.
        return pickImageOrVideo();
      })
      .then((picked) => {
        if (picked) setMedia(picked);
        else router.back();
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load this Room.'));
    // Runs once on mount only — re-picking is handled by handlePickAgain, not a re-run of this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!session) return null;

  const canSubmit = media !== null && !submitting;

  async function handlePickAgain() {
    setError(null);
    try {
      const picked = await pickImageOrVideo();
      if (picked) setMedia(picked);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open your photo library.');
    }
  }

  async function handleSubmit() {
    if (!canSubmit || !room || !userId || !media) return;
    setSubmitting(true);
    setError(null);
    try {
      setStatusLine(media.kind === 'video' ? 'Uploading video…' : 'Compressing and uploading…');
      await createStory(room.id, userId, media, caption);
      router.replace({ pathname: '/c/[communityId]', params: { communityId } });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not share that story.');
    } finally {
      setSubmitting(false);
      setStatusLine(null);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} disabled={submitting}>
            <Text style={styles.headerAction}>Cancel</Text>
          </Pressable>
          <Text style={styles.headingText}>New story</Text>
          <Pressable onPress={handleSubmit} disabled={!canSubmit}>
            {submitting ? (
              <ActivityIndicator color={Colors.accent.DEFAULT} />
            ) : (
              <Text style={[styles.headerAction, !canSubmit && styles.headerActionDisabled]}>Share</Text>
            )}
          </Pressable>
        </View>

        {media ? (
          <Pressable style={styles.mediaWrap} onPress={handlePickAgain} disabled={submitting}>
            {media.kind === 'video' ? (
              <StoryVideoPreview uri={media.uri} />
            ) : (
              <Image source={{ uri: media.uri }} style={styles.media} contentFit="cover" />
            )}
          </Pressable>
        ) : (
          <View style={styles.mediaWrap} />
        )}

        <TextInput
          style={styles.caption}
          value={caption}
          onChangeText={setCaption}
          placeholder={room ? `Say something about this, ${room.name}…` : 'Add a caption…'}
          placeholderTextColor={Colors.neutral[500]}
          multiline
          editable={!submitting}
        />

        {statusLine && <Text style={styles.status}>{statusLine}</Text>}
        {error && <Text style={styles.error}>{error}</Text>}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function StoryVideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.play();
  });
  return <VideoView player={player} style={styles.media} contentFit="cover" nativeControls={false} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  flex: {
    flex: 1,
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
    fontFamily: Fonts.heading,
    fontSize: 16,
    color: Colors.text,
  },
  headerAction: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.accent.DEFAULT,
  },
  headerActionDisabled: {
    opacity: 0.35,
  },
  mediaWrap: {
    flex: 1,
    marginHorizontal: Spacing[6],
    borderRadius: Radius.md,
    overflow: 'hidden',
    backgroundColor: Colors.surface,
  },
  media: {
    width: '100%',
    height: '100%',
  },
  caption: {
    minHeight: 60,
    margin: Spacing[6],
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.divider,
    padding: Spacing[4],
    fontSize: 15,
    lineHeight: 22,
    color: Colors.text,
    fontFamily: Fonts.body,
    textAlignVertical: 'top',
  },
  status: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.accent2[300],
    textAlign: 'center',
    paddingBottom: Spacing[3],
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.accent.DEFAULT,
    textAlign: 'center',
    paddingBottom: Spacing[3],
  },
});
