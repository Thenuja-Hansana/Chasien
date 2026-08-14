import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
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
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { deletePostImage, pickImage, uploadPostImage, type PickedImage } from '@/lib/media';
import { createPost } from '@/lib/posts';
import { fetchRoomBySlug, type Room } from '@/lib/rooms';

const MAX_POLL_OPTIONS = 4;

export default function CreatePost() {
  const { session } = useAuth();
  const { communityId } = useLocalSearchParams<{ communityId: string }>();

  const [room, setRoom] = useState<Room | null>(null);
  const [text, setText] = useState('');
  const [image, setImage] = useState<PickedImage | null>(null);
  const [pollOpen, setPollOpen] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [submitting, setSubmitting] = useState(false);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} disabled={submitting}>
            <Text style={styles.headerAction}>Cancel</Text>
          </Pressable>
          <Text style={styles.headingText}>New post</Text>
          <Pressable onPress={handleSubmit} disabled={!canSubmit}>
            {submitting ? (
              <ActivityIndicator color={Colors.accent.DEFAULT} />
            ) : (
              <Text style={[styles.headerAction, !canSubmit && styles.headerActionDisabled]}>Post</Text>
            )}
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <TextInput
            style={styles.caption}
            value={text}
            onChangeText={setText}
            placeholder={room ? `Say something in ${room.name}…` : 'Say something…'}
            placeholderTextColor={Colors.neutral[500]}
            multiline
            editable={!submitting}
          />

          {image ? (
            <View style={styles.imageWrap}>
              <Image source={{ uri: image.uri }} style={styles.image} contentFit="cover" />
              <Pressable style={styles.removeImage} onPress={() => setImage(null)} disabled={submitting} hitSlop={8}>
                <Icon name="close" size={16} color={Colors.text} />
              </Pressable>
            </View>
          ) : (
            <Pressable style={styles.addImage} onPress={handlePickImage} disabled={submitting}>
              <Icon name="addPhoto" size={20} color={Colors.accent.DEFAULT} />
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
                style={styles.input}
                value={pollQuestion}
                onChangeText={setPollQuestion}
                placeholder="Ask something"
                placeholderTextColor={Colors.neutral[500]}
                editable={!submitting}
              />
              {pollOptions.map((option, index) => (
                <TextInput
                  key={index}
                  style={styles.input}
                  value={option}
                  onChangeText={(v) => updateOption(index, v)}
                  placeholder={`Option ${index + 1}`}
                  placeholderTextColor={Colors.neutral[500]}
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
              <Icon name="checkDouble" size={20} color={Colors.accent2.DEFAULT} />
              <Text style={[styles.addImageText, { color: Colors.accent2[300] }]}>Add a poll</Text>
            </Pressable>
          )}

          {statusLine && <Text style={styles.status}>{statusLine}</Text>}
          {error && <Text style={styles.error}>{error}</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
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
  content: {
    paddingHorizontal: Spacing[6],
    paddingBottom: Spacing[8],
    gap: Spacing[3],
  },
  caption: {
    minHeight: 110,
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
  addImage: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[2],
    height: 48,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.divider,
  },
  addImageText: {
    fontFamily: Fonts.bodySemibold,
    fontSize: 13.5,
    color: Colors.accent[300],
  },
  imageWrap: {
    height: 230,
    borderRadius: Radius.md,
    overflow: 'hidden',
    backgroundColor: Colors.surface,
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
    borderColor: Colors.divider,
    backgroundColor: Colors.surface,
    gap: Spacing[2],
  },
  pollHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: Colors.neutral[500],
  },
  removePoll: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.accent.DEFAULT,
  },
  input: {
    height: 46,
    borderRadius: Radius.pill,
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.divider,
    paddingHorizontal: 18,
    fontSize: 14,
    color: Colors.text,
    fontFamily: Fonts.body,
  },
  addOption: {
    fontFamily: Fonts.bodySemibold,
    fontSize: 13,
    color: Colors.accent2[300],
    paddingVertical: Spacing[1],
  },
  hint: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.neutral[500],
  },
  status: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.accent2[300],
    textAlign: 'center',
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.accent.DEFAULT,
    textAlign: 'center',
  },
});
