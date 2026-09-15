import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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

import Icon from '@/components/Icon';
import { Fonts, MaxContentWidth, Radius, Spacing, Typography, type ThemeColors } from '@/constants/theme';
import { useCappedMediaHeight } from '@/hooks/use-capped-media-height';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { deletePostImage, pickImage, uploadPostImage, type PickedImage } from '@/lib/media';
import { feedAspectRatioFor } from '@/lib/mediaUtils';
import { createPost } from '@/lib/posts';
import { fetchRoomBySlug, type Room } from '@/lib/rooms';

const MAX_POLL_OPTIONS = 4;
const MAX_PREVIEW_HEIGHT_FRACTION = 0.5;

export default function CreatePost() {
  const { session } = useAuth();
  const { communityId } = useLocalSearchParams<{ communityId: string }>();
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [room, setRoom] = useState<Room | null>(null);
  const [text, setText] = useState('');
  const [image, setImage] = useState<PickedImage | null>(null);
  const [pollOpen, setPollOpen] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [submitting, setSubmitting] = useState(false);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One key rather than a separate hook per field, since the poll options
  // list is dynamic (up to MAX_POLL_OPTIONS) — 'caption' | 'question' |
  // `option-${index}`.
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const clearFocus = (key: string) => setFocusedField((f) => (f === key ? null : f));
  const maxPreviewHeight = useCappedMediaHeight(MAX_PREVIEW_HEIGHT_FRACTION);

  const userId = session?.user.id;

  // Resolves the slug in the route to the Room's real id, which is what
  // both the upload path and create_post() need.
  useEffect(() => {
    fetchRoomBySlug(communityId)
      .then(setRoom)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load this Room.'));
  }, [communityId]);

  if (!session) return null;

  const filledOptions = pollOptions.map((o) => o.trim()).filter(Boolean);
  const pollReady = !pollOpen || (pollQuestion.trim().length > 0 && filledOptions.length >= 2);
  // Mirrors create_post()'s own guard: a post needs at least one of the three.
  const hasContent = text.trim().length > 0 || image !== null || (pollOpen && pollQuestion.trim().length > 0);
  const canSubmit = hasContent && pollReady && !submitting;

  async function handlePickImage() {
    setError(null);
    try {
      const picked = await pickImage();
      if (picked) setImage(picked);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open your photo library.');
    }
  }

  async function handleSubmit() {
    if (!canSubmit || !room || !userId) return;
    setSubmitting(true);
    setError(null);

    let uploadedPath: string | null = null;
    try {
      if (image) {
        setStatusLine('Compressing and uploading image…');
        uploadedPath = await uploadPostImage(image, room.id, userId);
      }

      setStatusLine('Posting…');
      await createPost({
        roomId: room.id,
        text,
        mediaPaths: uploadedPath ? [uploadedPath] : [],
        pollQuestion: pollOpen ? pollQuestion : null,
        pollOptions: pollOpen ? filledOptions : [],
      });

      router.replace({ pathname: '/c/[communityId]', params: { communityId } });
    } catch (e) {
      // The image lands in storage before the post row exists, so a
      // failure here would otherwise strand an object nobody references.
      if (uploadedPath) await deletePostImage(uploadedPath).catch(() => {});
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
          <Pressable onPress={() => router.back()} disabled={submitting}>
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

          {image ? (
            // Sized to match what uploadPostImage()'s 'feed' crop will actually
            // keep, so the composer previews the real framing, not the full
            // uncropped photo the picker returned.
            <View
              style={[
                styles.imageWrap,
                { aspectRatio: feedAspectRatioFor(image.width, image.height), maxHeight: maxPreviewHeight },
              ]}
            >
              <Image source={{ uri: image.uri }} style={styles.image} contentFit="contain" />
              <Pressable style={styles.removeImage} onPress={() => setImage(null)} disabled={submitting} hitSlop={8}>
                <Icon name="close" size={16} color={colors.text} />
              </Pressable>
            </View>
          ) : (
            <Pressable style={styles.addImage} onPress={handlePickImage} disabled={submitting}>
              <Icon name="addPhoto" size={20} color={colors.accent.DEFAULT} />
              <Text style={styles.addImageText}>Add a photo</Text>
            </Pressable>
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
            <Pressable style={styles.addImage} onPress={() => setPollOpen(true)} disabled={submitting}>
              <Icon name="checkDouble" size={20} color={colors.accent2.DEFAULT} />
              <Text style={[styles.addImageText, { color: colors.accent2[300] }]}>Add a poll</Text>
            </Pressable>
          )}

          {statusLine && <Text style={styles.status}>{statusLine}</Text>}
          {error && <Text style={styles.error}>{error}</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
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
  addImage: {
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
  addImageText: {
    fontFamily: Fonts.bodySemibold,
    fontSize: 13.5,
    color: colors.accent[300],
  },
  imageWrap: {
    width: '100%',
    borderRadius: Radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  removeImage: {
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
