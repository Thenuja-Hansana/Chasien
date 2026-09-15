import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ConfirmModal from '@/components/ConfirmModal';
import Icon from '@/components/Icon';
import { Fonts, MaxContentWidth, Radius, Spacing, Typography, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import {
  captureImageOrVideo,
  deletePostMedia,
  MAX_POST_MEDIA_ITEMS,
  pickPostMedia,
  uploadPostMedia,
  type PickedMedia,
} from '@/lib/media';
import { createPost } from '@/lib/posts';
import { fetchRoomBySlug, type Room } from '@/lib/rooms';

const MAX_POLL_OPTIONS = 4;
const TILE_SIZE = 76;

export default function CreatePost() {
  const { session } = useAuth();
  const { communityId } = useLocalSearchParams<{ communityId: string }>();
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [room, setRoom] = useState<Room | null>(null);
  const [text, setText] = useState('');
  const [mediaItems, setMediaItems] = useState<PickedMedia[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [submitting, setSubmitting] = useState(false);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  // One key rather than a separate hook per field, since the poll options
  // list is dynamic (up to MAX_POLL_OPTIONS) — 'caption' | 'question' |
  // `option-${index}`.
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const clearFocus = (key: string) => setFocusedField((f) => (f === key ? null : f));

  const userId = session?.user.id;

  // Resolves the slug in the route to the Room's real id, which is what
  // both the upload path and create_post() need.
  useEffect(() => {
    fetchRoomBySlug(communityId)
      .then(setRoom)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load this Room.'));
  }, [communityId]);

  const filledOptions = pollOptions.map((o) => o.trim()).filter(Boolean);
  const pollReady = !pollOpen || (pollQuestion.trim().length > 0 && filledOptions.length >= 2);
  // Mirrors create_post()'s own guard: a post needs at least one of the three.
  const hasContent = text.trim().length > 0 || mediaItems.length > 0 || (pollOpen && pollQuestion.trim().length > 0);
  const canSubmit = hasContent && pollReady && !submitting;
  // Broader than hasContent on purpose — opening the poll builder at all
  // (even before typing a question) is something worth warning about
  // losing, not just a submittable poll.
  const hasChanges = text.trim().length > 0 || mediaItems.length > 0 || pollOpen;

  const handleClose = useCallback(() => {
    if (hasChanges) {
      setShowDiscardConfirm(true);
    } else {
      router.back();
    }
  }, [hasChanges]);

  // The on-screen Cancel only ever went through handleClose — the Android
  // hardware back button and edge-swipe gesture are a separate system
  // event native-stack handles on its own by default, so without this a
  // back-gesture here silently discarded a drafted post with no
  // confirmation at all (see create-community.tsx for the original fix
  // this mirrors).
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        handleClose();
        return true;
      });
      return () => subscription.remove();
    }, [handleClose]),
  );

  if (!session) return null;

  async function handlePickMedia() {
    setError(null);
    try {
      const remaining = MAX_POST_MEDIA_ITEMS - mediaItems.length;
      const picked = await pickPostMedia(remaining);
      if (picked.length > 0) setMediaItems((prev) => [...prev, ...picked]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open your photo library.');
    } finally {
      setPickerOpen(false);
    }
  }

  async function handleCaptureMedia() {
    setError(null);
    try {
      const captured = await captureImageOrVideo();
      if (captured) setMediaItems((prev) => [...prev, captured]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open the camera.');
    } finally {
      setPickerOpen(false);
    }
  }

  function removeMediaAt(index: number) {
    setMediaItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    if (!canSubmit || !room || !userId) return;
    setSubmitting(true);
    setError(null);

    // Sequential, not Promise.all: lets statusLine show real progress and
    // means cleanup-on-failure is just "delete what's already in this
    // array" — no separate bookkeeping needed for which uploads landed
    // before a later one failed.
    const uploadedPaths: string[] = [];
    try {
      for (let i = 0; i < mediaItems.length; i++) {
        setStatusLine(mediaItems.length > 1 ? `Uploading ${i + 1} of ${mediaItems.length}…` : 'Uploading…');
        uploadedPaths.push(await uploadPostMedia(mediaItems[i], room.id, userId));
      }

      setStatusLine('Posting…');
      await createPost({
        roomId: room.id,
        text,
        mediaPaths: uploadedPaths,
        pollQuestion: pollOpen ? pollQuestion : null,
        pollOptions: pollOpen ? filledOptions : [],
      });

      router.replace({ pathname: '/c/[communityId]', params: { communityId } });
    } catch (e) {
      // Media lands in storage before the post row exists, so a failure
      // here would otherwise strand every object already uploaded, not
      // just the last one.
      if (uploadedPaths.length > 0) {
        await Promise.allSettled(uploadedPaths.map((p) => deletePostMedia(p)));
      }
      setError(e instanceof Error ? e.message : 'Could not publish that post.');
    } finally {
      setSubmitting(false);
      setStatusLine(null);
    }
  }

  function updateOption(index: number, value: string) {
    setPollOptions((prev) => prev.map((o, i) => (i === index ? value : o)));
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.header}>
          <Pressable onPress={handleClose} disabled={submitting}>
            <Text style={styles.headerAction}>Cancel</Text>
          </Pressable>
          <Text style={styles.headingText}>New post</Text>
          <Pressable onPress={handleSubmit} disabled={!canSubmit}>
            {submitting ? (
              <ActivityIndicator color={colors.accent.DEFAULT} />
            ) : (
              <Text style={[styles.headerAction, !canSubmit && styles.headerActionDisabled]}>Post</Text>
            )}
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <TextInput
            style={[styles.caption, focusedField === 'caption' && styles.captionFocused]}
            value={text}
            onChangeText={setText}
            onFocus={() => setFocusedField('caption')}
            onBlur={() => clearFocus('caption')}
            placeholder={room ? `Say something in ${room.name}…` : 'Say something…'}
            placeholderTextColor={colors.neutral[500]}
            multiline
            editable={!submitting}
          />

          {mediaItems.length === 0 && !pickerOpen && (
            <Pressable style={styles.addMedia} onPress={() => setPickerOpen(true)} disabled={submitting}>
              <Icon name="addPhoto" size={20} color={colors.accent.DEFAULT} />
              <Text style={styles.addMediaText}>Add photos or video</Text>
            </Pressable>
          )}

          {mediaItems.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tileRow}>
              {mediaItems.map((item, index) => (
                <ComposerMediaTile
                  key={item.uri}
                  media={item}
                  onRemove={() => removeMediaAt(index)}
                  disabled={submitting}
                />
              ))}
              {mediaItems.length < MAX_POST_MEDIA_ITEMS && (
                <Pressable style={styles.addTile} onPress={() => setPickerOpen(true)} disabled={submitting}>
                  <Icon name="addPhoto" size={18} color={colors.accent.DEFAULT} />
                </Pressable>
              )}
            </ScrollView>
          )}

          {pickerOpen && (
            <View style={styles.pickChoice}>
              <Pressable style={styles.pickButton} onPress={handleCaptureMedia} disabled={submitting}>
                <Icon name="camera" size={19} color={colors.accent.DEFAULT} />
                <Text style={styles.pickButtonText}>Take photo or video</Text>
              </Pressable>
              <Pressable style={styles.pickButton} onPress={handlePickMedia} disabled={submitting}>
                <Icon name="addPhoto" size={19} color={colors.accent.DEFAULT} />
                <Text style={styles.pickButtonText}>Choose from gallery</Text>
              </Pressable>
            </View>
          )}

          {pollOpen ? (
            <View style={styles.pollBox}>
              <View style={styles.pollHeader}>
                <Text style={styles.label}>Poll</Text>
                <Pressable
                  onPress={() => {
                    setPollOpen(false);
                    setPollQuestion('');
                    setPollOptions(['', '']);
                  }}
                  disabled={submitting}
                >
                  <Text style={styles.removePoll}>Remove</Text>
                </Pressable>
              </View>
              <TextInput
                style={[styles.input, focusedField === 'question' && styles.inputFocused]}
                value={pollQuestion}
                onChangeText={setPollQuestion}
                onFocus={() => setFocusedField('question')}
                onBlur={() => clearFocus('question')}
                placeholder="Ask something"
                placeholderTextColor={colors.neutral[500]}
                editable={!submitting}
              />
              {pollOptions.map((option, index) => (
                <TextInput
                  key={index}
                  style={[styles.input, focusedField === `option-${index}` && styles.inputFocused]}
                  value={option}
                  onChangeText={(v) => updateOption(index, v)}
                  onFocus={() => setFocusedField(`option-${index}`)}
                  onBlur={() => clearFocus(`option-${index}`)}
                  placeholder={`Option ${index + 1}`}
                  placeholderTextColor={colors.neutral[500]}
                  editable={!submitting}
                />
              ))}
              {pollOptions.length < MAX_POLL_OPTIONS && (
                <Pressable onPress={() => setPollOptions((prev) => [...prev, ''])} disabled={submitting}>
                  <Text style={styles.addOption}>+ Add option</Text>
                </Pressable>
              )}
              {!pollReady && <Text style={styles.hint}>A poll needs a question and at least two options.</Text>}
            </View>
          ) : (
            <Pressable style={styles.addMedia} onPress={() => setPollOpen(true)} disabled={submitting}>
              <Icon name="checkDouble" size={20} color={colors.accent2.DEFAULT} />
              <Text style={[styles.addMediaText, { color: colors.accent2[300] }]}>Add a poll</Text>
            </Pressable>
          )}

          {statusLine && <Text style={styles.status}>{statusLine}</Text>}
          {error && <Text style={styles.error}>{error}</Text>}
        </ScrollView>
      </KeyboardAvoidingView>

      <ConfirmModal
        visible={showDiscardConfirm}
        title="Discard this post?"
        body="Everything you've entered so far will be lost — this can't be undone."
        cancelLabel="Keep Editing"
        confirmLabel="Discard"
        onCancel={() => setShowDiscardConfirm(false)}
        onConfirm={() => router.back()}
      />
    </SafeAreaView>
  );
}

/**
 * One thumbnail in the composer's media strip. Branches to a separate
 * component per kind (rather than one component with a conditional
 * `useVideoPlayer` call) so an image tile never allocates a native video
 * player it will never use.
 */
function ComposerMediaTile({ media, onRemove, disabled }: { media: PickedMedia; onRemove: () => void; disabled: boolean }) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.tile}>
      {media.kind === 'video' ? <ComposerVideoThumb uri={media.uri} /> : (
        <Image source={{ uri: media.uri }} style={styles.tileMedia} contentFit="cover" />
      )}
      <Pressable
        style={styles.tileRemove}
        onPress={onRemove}
        disabled={disabled}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Remove"
      >
        <Icon name="close" size={13} color={colors.text} />
      </Pressable>
    </View>
  );
}

/**
 * A paused, no-controls video preview (this is a picker tile, not a
 * player: tapping remove is the only interaction it needs) with a
 * centered play glyph standing in for a real poster frame, since this
 * app has no thumbnail-extraction step and doesn't need one for a
 * handful of ephemeral composer tiles.
 */
function ComposerVideoThumb({ uri }: { uri: string }) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const player = useVideoPlayer(uri);

  return (
    <View style={styles.tileVideoWrap}>
      <VideoView player={player} style={styles.tileMedia} contentFit="cover" nativeControls={false} />
      <View style={styles.tilePlayBadge}>
        <Icon name="play" size={14} color="#ffffff" />
      </View>
    </View>
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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[4],
    paddingBottom: Spacing[4],
  },
  headingText: {
    fontFamily: Fonts.heading,
    fontSize: 16,
    color: colors.text,
  },
  headerAction: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: colors.accent.DEFAULT,
  },
  headerActionDisabled: {
    opacity: 0.35,
  },
  content: {
    paddingHorizontal: Spacing[6],
    paddingBottom: Spacing[8],
    gap: Spacing[3],
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  caption: {
    minHeight: 110,
    borderRadius: Radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    padding: Spacing[4],
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
    fontFamily: Fonts.body,
    textAlignVertical: 'top',
  },
  captionFocused: {
    borderColor: colors.accent.DEFAULT,
    borderWidth: 1.5,
  },
  addMedia: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[2],
    height: 48,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.divider,
  },
  addMediaText: {
    fontFamily: Fonts.bodySemibold,
    fontSize: 13.5,
    color: colors.accent[300],
  },
  tileRow: {
    gap: Spacing[2],
  },
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderRadius: Radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  tileMedia: {
    width: '100%',
    height: '100%',
  },
  tileVideoWrap: {
    width: '100%',
    height: '100%',
  },
  tilePlayBadge: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileRemove: {
    position: 'absolute',
    right: 4,
    top: 4,
    width: 22,
    height: 22,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickChoice: {
    flexDirection: 'row',
    gap: Spacing[2],
  },
  pickButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[2],
    height: 48,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.divider,
    paddingHorizontal: Spacing[2],
  },
  pickButtonText: {
    fontFamily: Fonts.bodySemibold,
    fontSize: 12.5,
    color: colors.accent[300],
    flexShrink: 1,
  },
  pollBox: {
    padding: Spacing[3],
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
    gap: Spacing[2],
  },
  pollHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    ...Typography.label,
    color: colors.neutral[500],
  },
  removePoll: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: colors.accent.DEFAULT,
  },
  input: {
    height: 46,
    borderRadius: Radius.pill,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingHorizontal: 18,
    fontSize: 14,
    color: colors.text,
    fontFamily: Fonts.body,
  },
  inputFocused: {
    borderColor: colors.accent.DEFAULT,
    borderWidth: 1.5,
  },
  addOption: {
    fontFamily: Fonts.bodySemibold,
    fontSize: 13,
    color: colors.accent2[300],
    paddingVertical: Spacing[1],
  },
  hint: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: colors.neutral[500],
  },
  status: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: colors.accent2[300],
    textAlign: 'center',
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: colors.accent.DEFAULT,
    textAlign: 'center',
  },
});
