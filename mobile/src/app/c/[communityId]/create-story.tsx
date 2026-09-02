import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Icon from '@/components/Icon';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { captureImageOrVideo, pickImageOrVideo, type PickedMedia } from '@/lib/media';
import { fetchRoomBySlug, type Room } from '@/lib/rooms';
import { createStory } from '@/lib/stories';

/**
 * Mirrors create-post.tsx's structure, simplified: one required media
 * item, optional caption, no poll.
 *
 * Deliberately doesn't auto-launch a picker on mount the way an earlier
 * version did (that only ever offered the gallery). Camera capture
 * (`captureImageOrVideo()`, lib/media.ts) has to be triggered directly
 * from a tap on web — browsers block `launchCameraAsync` unless it's
 * called from a real user interaction, not an effect — so both options
 * are shown as an explicit choice instead, which also just reads better
 * than a picker sheet appearing before the screen has settled.
 */
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
      .then(setRoom)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load this Room.'));
  }, [communityId]);

  if (!session) return null;

  const canSubmit = media !== null && !submitting;

  async function handleCapture() {
    setError(null);
    try {
      const captured = await captureImageOrVideo();
      if (captured) setMedia(captured);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open the camera.');
    }
  }

  async function handlePick() {
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
          <View style={styles.mediaWrap}>
            {media.kind === 'video' ? (
              <StoryVideoPreview uri={media.uri} />
            ) : (
              <Image source={{ uri: media.uri }} style={styles.media} contentFit="cover" />
            )}
            <Pressable style={styles.changeMedia} onPress={() => setMedia(null)} disabled={submitting} hitSlop={8}>
              <Icon name="close" size={16} color={Colors.text} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.mediaWrap}>
            <View style={styles.pickChoice}>
              <Pressable style={styles.pickButton} onPress={handleCapture} disabled={submitting}>
                <Icon name="camera" size={22} color={Colors.accent.DEFAULT} />
                <Text style={styles.pickButtonText}>Take photo or video</Text>
              </Pressable>
              <Pressable style={styles.pickButton} onPress={handlePick} disabled={submitting}>
                <Icon name="addPhoto" size={22} color={Colors.accent.DEFAULT} />
                <Text style={styles.pickButtonText}>Choose from gallery</Text>
              </Pressable>
            </View>
          </View>
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
  changeMedia: {
    position: 'absolute',
    right: 10,
    top: 10,
    width: 30,
    height: 30,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickChoice: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[3],
  },
  pickButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[2],
    height: 48,
    width: '80%',
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.divider,
  },
  pickButtonText: {
    fontFamily: Fonts.bodySemibold,
    fontSize: 13.5,
    color: Colors.accent[300],
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
