import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Icon from '@/components/Icon';
import { Fonts, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { blockUser } from '@/lib/blocks';
import { fileReport, REPORT_REASONS, type ReportReason, type ReportTargetType } from '@/lib/reports';

export type ReportTarget = {
  type: ReportTargetType;
  id: string;
  /** What the sheet calls it: "post", "comment", "@tobi", "this Room". */
  noun: string;
  /** The person responsible, when there is one — offers "Also block" alongside the report. */
  blockUser?: { id: string; handle: string };
};

/**
 * The one report flow, used for posts, comments, chat messages, stories,
 * profiles and Rooms (Phase 9). A reason is required (the server only
 * accepts the fixed list), details are optional. The server captures what
 * was reported and alerts the app admins; this sheet never sends the
 * content itself. Blocking is offered in the same step, because someone
 * reporting a person usually doesn't want to keep seeing them either.
 */
export default function ReportSheet({
  target,
  onClose,
  onBlocked,
}: {
  /** null = closed. */
  target: ReportTarget | null;
  onClose: () => void;
  /** Called after a successful "Also block", so the screen can refetch. */
  onBlocked?: (userId: string) => void;
}) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const { session } = useAuth();

  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ blocked: boolean } | null>(null);

  // A different target (or reopening) starts clean — same pattern as
  // CommentsSheet, rather than a reset effect.
  const targetKey = target ? `${target.type}:${target.id}` : null;
  const [shownKey, setShownKey] = useState(targetKey);
  if (targetKey !== shownKey) {
    setShownKey(targetKey);
    setReason(null);
    setDetails('');
    setAlsoBlock(false);
    setSending(false);
    setError(null);
    setDone(null);
  }

  async function submit() {
    const myId = session?.user.id;
    if (!target || !reason || !myId || sending) return;
    setSending(true);
    setError(null);
    const blockTarget = alsoBlock ? target.blockUser : undefined;
    // A nested function with .catch() rather than try/catch: the React
    // Compiler can't compile the `?.` call below inside a `try`.
    const send = async () => {
      await fileReport(myId, target.type, target.id, reason, details);
      if (blockTarget) {
        await blockUser(blockTarget.id);
        onBlocked?.(blockTarget.id);
      }
      setDone({ blocked: !!blockTarget });
    };
    await send().catch((e) => {
      setError(e instanceof Error ? e.message : 'Could not send that report.');
    });
    setSending(false);
  }

  return (
    <Modal visible={target !== null} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          {/* Swallows the backdrop's onPress so tapping inside the sheet doesn't close it. */}
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + Spacing[4] }]} onPress={() => {}}>
            <View style={styles.grabber} />

            {done ? (
              <View style={styles.doneWrap}>
                <View style={styles.doneIcon}>
                  <Icon name="check" size={26} color={colors.text} strokeWidth={2.4} />
                </View>
                <Text style={styles.title}>Thanks for letting us know</Text>
                <Text style={styles.body}>
                  We&apos;ll review it, and remove it if it breaks the community guidelines. They won&apos;t be told who reported them.
                  {done.blocked && target?.blockUser ? ` You've also blocked @${target.blockUser.handle}.` : ''}
                </Text>
                <Pressable style={[styles.primaryButton, styles.fullWidth]} onPress={onClose} accessibilityRole="button">
                  <Text style={styles.primaryButtonText}>Done</Text>
                </Pressable>
              </View>
            ) : (
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scrollContent}>
                <Text style={styles.title}>Report {target?.noun}</Text>
                <Text style={styles.body}>Why are you reporting it? They won&apos;t be told who reported them.</Text>

                <View style={styles.reasons}>
                  {REPORT_REASONS.map((r) => {
                    const selected = reason === r.key;
                    return (
                      <Pressable
                        key={r.key}
                        style={styles.reasonRow}
                        onPress={() => setReason(r.key)}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selected }}
                      >
                        <Text style={styles.reasonText}>{r.label}</Text>
                        <View style={[styles.radio, selected && styles.radioOn]}>{selected && <View style={styles.radioDot} />}</View>
                      </Pressable>
                    );
                  })}
                </View>

                <TextInput
                  style={styles.details}
                  value={details}
                  onChangeText={setDetails}
                  placeholder="Anything else we should know? (optional)"
                  placeholderTextColor={colors.neutral[500]}
                  multiline
                  maxLength={1000}
                />

                {target?.blockUser && (
                  <Pressable
                    style={styles.blockRow}
                    onPress={() => setAlsoBlock((v) => !v)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: alsoBlock }}
                  >
                    <View style={[styles.checkbox, alsoBlock && styles.checkboxOn]}>
                      {alsoBlock && <Icon name="check" size={14} color={colors.bg} strokeWidth={3} />}
                    </View>
                    <Text style={styles.blockText}>Also block @{target.blockUser.handle}</Text>
                  </Pressable>
                )}

                {error && <Text style={styles.error}>{error}</Text>}

                <Pressable
                  style={[styles.primaryButton, (!reason || sending) && styles.primaryButtonDisabled]}
                  onPress={submit}
                  disabled={!reason || sending}
                  accessibilityRole="button"
                >
                  {sending ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.primaryButtonText}>Send report</Text>}
                </Pressable>
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    flex: {
      flex: 1,
    },
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
    },
    sheet: {
      maxHeight: '90%',
      backgroundColor: colors.bg,
      borderTopLeftRadius: Radius.lg,
      borderTopRightRadius: Radius.lg,
      paddingTop: Spacing[3],
      paddingHorizontal: Spacing[6],
    },
    grabber: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: Radius.pill,
      backgroundColor: colors.divider,
      marginBottom: Spacing[3],
    },
    scrollContent: {
      paddingBottom: Spacing[2],
    },
    title: {
      fontFamily: Fonts.bodyBold,
      fontSize: 18,
      color: colors.text,
    },
    body: {
      marginTop: Spacing[1],
      fontFamily: Fonts.body,
      fontSize: 14,
      lineHeight: 20,
      color: colors.neutral[400],
    },
    reasons: {
      marginTop: Spacing[3],
    },
    reasonRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 48,
      borderTopWidth: 1,
      borderTopColor: colors.divider,
    },
    reasonText: {
      fontFamily: Fonts.body,
      fontSize: 15,
      color: colors.text,
    },
    radio: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 2,
      borderColor: colors.neutral[500],
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioOn: {
      borderColor: colors.text,
    },
    radioDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.text,
    },
    details: {
      marginTop: Spacing[3],
      minHeight: 72,
      maxHeight: 140,
      padding: Spacing[3],
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.divider,
      fontFamily: Fonts.body,
      fontSize: 14,
      color: colors.text,
      textAlignVertical: 'top',
    },
    blockRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing[3],
      marginTop: Spacing[4],
    },
    checkbox: {
      width: 22,
      height: 22,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: colors.neutral[500],
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxOn: {
      backgroundColor: colors.text,
      borderColor: colors.text,
    },
    blockText: {
      fontFamily: Fonts.body,
      fontSize: 15,
      color: colors.text,
    },
    error: {
      marginTop: Spacing[3],
      fontFamily: Fonts.body,
      fontSize: 13,
      color: colors.error,
    },
    primaryButton: {
      marginTop: Spacing[4],
      height: 48,
      borderRadius: Radius.pill,
      backgroundColor: colors.text,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // The done state centres its content, which would otherwise shrink the
    // button to its label (found in a screenshot, not by the text checks).
    fullWidth: {
      alignSelf: 'stretch',
    },
    primaryButtonDisabled: {
      opacity: 0.4,
    },
    primaryButtonText: {
      fontFamily: Fonts.bodyBold,
      fontSize: 15,
      color: colors.bg,
    },
    doneWrap: {
      alignItems: 'center',
      paddingVertical: Spacing[4],
      gap: Spacing[2],
    },
    doneIcon: {
      width: 56,
      height: 56,
      borderRadius: 28,
      borderWidth: 2,
      borderColor: colors.divider,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: Spacing[2],
    },
  });
