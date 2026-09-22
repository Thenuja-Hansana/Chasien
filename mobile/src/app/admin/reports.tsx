import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ConfirmModal from '@/components/ConfirmModal';
import EmptyState from '@/components/EmptyState';
import Icon from '@/components/Icon';
import Skeleton from '@/components/Skeleton';
import { Fonts, MaxContentWidth, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { removeComment, removeMessage, removeStory } from '@/lib/moderation';
import { deletePost, relativeTime } from '@/lib/posts';
import {
  fetchAmIAppAdmin,
  fetchReports,
  fetchSuspensions,
  reasonLabel,
  resolveReport,
  signReportMedia,
  suspendUser,
  unsuspendUser,
  type AdminReport,
  type Suspension,
} from '@/lib/reports';

type Tab = 'open' | 'resolved' | 'suspended';

/** Content types an admin can remove; users and Rooms can only be suspended or dismissed. */
const REMOVABLE = new Set(['post', 'comment', 'message', 'story']);

function mediaKind(path: string): 'image' | 'video' | 'audio' {
  if (/\.mp4$/i.test(path)) return 'video';
  if (/\.(m4a|aac|mp3|caf|wav|webm)$/i.test(path)) return 'audio';
  return 'image';
}

/** The words the snapshot has for what was reported, whatever its type. */
function excerptOf(r: AdminReport): string | null {
  const s = r.snapshot;
  if (r.targetType === 'user') return [s.name, s.bio].filter(Boolean).join(' — ') || null;
  if (r.targetType === 'room') return [s.name, s.description].filter(Boolean).join(' — ') || null;
  return s.text ?? s.caption ?? null;
}

type Pending =
  | { kind: 'remove'; report: AdminReport }
  | { kind: 'suspend'; report: AdminReport }
  | { kind: 'unsuspend'; suspension: Suspension };

/**
 * App admins only (Phase 9): the queue of reports, their outcomes, and
 * suspended accounts. Everything here is enforced server-side — reports are
 * readable only by app admins under RLS, resolve_report() checks the
 * caller, content removal goes through the same functions Room mods use
 * (which let app admins act in any Room), and suspending goes through the
 * `moderate` Edge Function. A non-admin who reached this screen would see
 * nothing to act on.
 *
 * Every action that changes someone's content or account asks first, and
 * a suspension can be undone from the Suspended tab.
 */
export default function AdminReports() {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>('open');
  const [open, setOpen] = useState<AdminReport[] | null>(null);
  const [resolved, setResolved] = useState<AdminReport[] | null>(null);
  const [suspensions, setSuspensions] = useState<Suspension[] | null>(null);
  const [media, setMedia] = useState<Map<string, { path: string; url: string | null }[]>>(new Map());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const loadAll = async () => {
      const admin = await fetchAmIAppAdmin();
      setIsAdmin(admin);
      if (!admin) return;
      const [o, r, s] = await Promise.all([fetchReports('open'), fetchReports('resolved'), fetchSuspensions()]);
      setOpen(o);
      setResolved(r);
      setSuspensions(s);
    };
    loadAll().catch((e) => setError(errorMessage(e, 'Failed to load reports.')));
  }, []);

  useFocusEffect(load);

  async function showMedia(report: AdminReport) {
    setError(null);
    try {
      const signed = await signReportMedia(report.id);
      setMedia((prev) => new Map(prev).set(report.id, signed));
    } catch (e) {
      setError(errorMessage(e, 'Could not load that media.'));
    }
  }

  async function dismiss(report: AdminReport) {
    setBusyId(report.id);
    setError(null);
    try {
      await resolveReport(report.id, 'dismissed');
      load();
    } catch (e) {
      setError(errorMessage(e, 'Could not dismiss that report.'));
    }
    setBusyId(null);
  }

  // Removal and the report's outcome are two calls. If the content was
  // already removed (by a Room mod, say), the removal fails with "not
  // found" and the report stays open for the admin to dismiss.
  async function removeContent(report: AdminReport) {
    setBusyId(report.id);
    setError(null);
    const remove =
      report.targetType === 'post'
        ? () => deletePost(report.targetId)
        : report.targetType === 'comment'
          ? () => removeComment(report.targetId)
          : report.targetType === 'message'
            ? () => removeMessage(report.targetId)
            : () => removeStory(report.targetId);
    try {
      await remove();
      await resolveReport(report.id, 'actioned');
      load();
    } catch (e) {
      setError(errorMessage(e, 'Could not remove that.'));
    }
    setBusyId(null);
  }

  async function suspendAuthor(report: AdminReport) {
    const authorId = report.snapshot.author_id;
    if (!authorId) return;
    setBusyId(report.id);
    setError(null);
    try {
      await suspendUser(authorId, reasonLabel(report.reason), report.id);
      load();
    } catch (e) {
      setError(errorMessage(e, 'Could not suspend that account.'));
    }
    setBusyId(null);
  }

  async function unsuspend(suspension: Suspension) {
    setBusyId(suspension.userId);
    setError(null);
    try {
      await unsuspendUser(suspension.userId);
      load();
    } catch (e) {
      setError(errorMessage(e, 'Could not lift that suspension.'));
    }
    setBusyId(null);
  }

  function renderReport(report: AdminReport, actionable: boolean) {
    const excerpt = excerptOf(report);
    const author = report.snapshot.author_handle;
    const signed = media.get(report.id);
    const hasMedia =
      (report.snapshot.media?.length ?? 0) > 0 || !!report.snapshot.media_url || !!report.snapshot.image_url || !!report.snapshot.voice_url;
    return (
      <View key={report.id} style={styles.card}>
        <View style={styles.cardTop}>
          <Text style={styles.reason}>
            {reasonLabel(report.reason)} · {report.targetType}
          </Text>
          <Text style={styles.meta}>{relativeTime(report.createdAt)}</Text>
        </View>
        <Text style={styles.meta}>
          {author ? `By @${author}` : 'Author unknown'}
          {report.snapshot.room_name ? ` · in ${report.snapshot.room_name}` : ''}
          {report.reporterHandle ? ` · reported by @${report.reporterHandle}` : ''}
        </Text>
        {excerpt && (
          <Text style={styles.excerpt} numberOfLines={6}>
            “{excerpt}”
          </Text>
        )}
        {report.details && <Text style={styles.details}>Reporter says: {report.details}</Text>}

        {hasMedia &&
          (signed ? (
            <View style={styles.mediaRow}>
              {signed.map((m) =>
                !m.url ? (
                  <Text key={m.path} style={styles.meta}>
                    (media no longer stored)
                  </Text>
                ) : mediaKind(m.path) === 'image' ? (
                  <Image key={m.path} source={{ uri: m.url }} style={styles.thumb} contentFit="cover" />
                ) : (
                  <Pressable key={m.path} onPress={() => m.url && Linking.openURL(m.url)} accessibilityRole="link">
                    <Text style={styles.link}>Open {mediaKind(m.path) === 'video' ? 'video' : 'voice note'}</Text>
                  </Pressable>
                ),
              )}
            </View>
          ) : (
            <Pressable onPress={() => showMedia(report)} accessibilityRole="button">
              <Text style={styles.link}>Show media</Text>
            </Pressable>
          ))}

        {actionable ? (
          busyId === report.id ? (
            <ActivityIndicator style={styles.busy} color={colors.text} />
          ) : (
            <View style={styles.actions}>
              {REMOVABLE.has(report.targetType) && (
                <Pressable style={[styles.action, styles.actionDanger]} onPress={() => setPending({ kind: 'remove', report })}>
                  <Text style={styles.actionDangerText}>Remove {report.targetType}</Text>
                </Pressable>
              )}
              {report.snapshot.author_id && (
                <Pressable style={[styles.action, styles.actionDanger]} onPress={() => setPending({ kind: 'suspend', report })}>
                  <Text style={styles.actionDangerText}>Suspend {author ? `@${author}` : 'author'}</Text>
                </Pressable>
              )}
              <Pressable style={styles.action} onPress={() => dismiss(report)}>
                <Text style={styles.actionText}>Dismiss</Text>
              </Pressable>
            </View>
          )
        ) : (
          <Text style={styles.outcome}>
            {report.status === 'dismissed' ? 'Dismissed' : report.status === 'actioned' ? 'Action taken' : 'Reviewed'}
            {report.reviewedAt ? ` · ${relativeTime(report.reviewedAt)}` : ''}
          </Text>
        )}
      </View>
    );
  }

  const list = tab === 'open' ? open : tab === 'resolved' ? resolved : null;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable style={styles.headerSide} hitSlop={8} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="back" size={22} color={colors.text} strokeWidth={2.4} />
        </Pressable>
        <Text style={styles.headerTitle}>Reports</Text>
        <View style={styles.headerSide} />
      </View>

      {isAdmin === false ? (
        <EmptyState icon="shield" heading="App admins only" message="Reports are reviewed by the people who run Chasien." />
      ) : (
        <>
          <View style={styles.tabs}>
            {(['open', 'resolved', 'suspended'] as const).map((t) => (
              <Pressable key={t} style={[styles.tab, tab === t && styles.tabOn]} onPress={() => setTab(t)} accessibilityRole="tab" accessibilityState={{ selected: tab === t }}>
                <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>
                  {t === 'open' ? `Open${open ? ` (${open.length})` : ''}` : t === 'resolved' ? 'Resolved' : 'Suspended'}
                </Text>
              </Pressable>
            ))}
          </View>

          {error && <Text style={styles.error}>{error}</Text>}

          <ScrollView contentContainerStyle={styles.list}>
            {tab === 'suspended' ? (
              suspensions === null ? (
                <Skeleton width="100%" height={70} radius={Radius.md} />
              ) : suspensions.length === 0 ? (
                <EmptyState icon="shield" message="No suspended accounts." />
              ) : (
                suspensions.map((sus) => (
                  <View key={sus.userId} style={styles.card}>
                    <Text style={styles.reason}>
                      {sus.name} <Text style={styles.meta}>@{sus.handle}</Text>
                    </Text>
                    <Text style={styles.meta}>
                      Suspended {relativeTime(sus.createdAt)}
                      {sus.reason ? ` · ${sus.reason}` : ''}
                    </Text>
                    {busyId === sus.userId ? (
                      <ActivityIndicator style={styles.busy} color={colors.text} />
                    ) : (
                      <View style={styles.actions}>
                        <Pressable style={styles.action} onPress={() => setPending({ kind: 'unsuspend', suspension: sus })}>
                          <Text style={styles.actionText}>Unsuspend</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                ))
              )
            ) : list === null ? (
              <Skeleton width="100%" height={120} radius={Radius.md} />
            ) : list.length === 0 ? (
              <EmptyState icon="shield" message={tab === 'open' ? 'Nothing to review.' : 'No resolved reports yet.'} />
            ) : (
              list.map((r) => renderReport(r, tab === 'open'))
            )}
          </ScrollView>
        </>
      )}

      <ConfirmModal
        visible={pending !== null}
        title={
          pending?.kind === 'remove'
            ? `Remove this ${pending.report.targetType}?`
            : pending?.kind === 'suspend'
              ? `Suspend @${pending.report.snapshot.author_handle ?? 'this account'}?`
              : pending?.kind === 'unsuspend'
                ? `Unsuspend @${pending.suspension.handle}?`
                : ''
        }
        body={
          pending?.kind === 'remove'
            ? "It'll be removed for everyone and logged in its Room's moderation log. The report is marked as actioned."
            : pending?.kind === 'suspend'
              ? "They can't sign in again until you lift it. A session they're already in keeps working for up to an hour. Their existing content stays unless you remove it."
              : "They'll be able to sign in again."
        }
        confirmLabel={pending?.kind === 'remove' ? 'Remove' : pending?.kind === 'suspend' ? 'Suspend' : 'Unsuspend'}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const p = pending;
          setPending(null);
          if (!p) return;
          if (p.kind === 'remove') removeContent(p.report);
          else if (p.kind === 'suspend') suspendAuthor(p.report);
          else unsuspend(p.suspension);
        }}
      />
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Spacing[4],
      paddingTop: Spacing[4],
      paddingBottom: Spacing[3],
    },
    headerSide: {
      width: 32,
    },
    headerTitle: {
      fontFamily: Fonts.bodyBold,
      fontSize: 18,
      color: colors.text,
    },
    tabs: {
      flexDirection: 'row',
      gap: Spacing[2],
      paddingHorizontal: Spacing[4],
      paddingBottom: Spacing[3],
    },
    tab: {
      paddingHorizontal: Spacing[4],
      height: 34,
      borderRadius: Radius.pill,
      borderWidth: 1,
      borderColor: colors.divider,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tabOn: {
      backgroundColor: colors.text,
      borderColor: colors.text,
    },
    tabText: {
      fontFamily: Fonts.bodySemibold,
      fontSize: 13.5,
      color: colors.text,
    },
    tabTextOn: {
      color: colors.bg,
    },
    error: {
      fontFamily: Fonts.body,
      fontSize: 13,
      color: colors.error,
      paddingHorizontal: Spacing[4],
      paddingBottom: Spacing[2],
    },
    list: {
      paddingHorizontal: Spacing[4],
      paddingBottom: Spacing[8],
      gap: Spacing[3],
      width: '100%',
      maxWidth: MaxContentWidth,
      alignSelf: 'center',
    },
    card: {
      padding: Spacing[4],
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.divider,
      gap: 6,
    },
    cardTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      gap: Spacing[2],
    },
    reason: {
      flexShrink: 1,
      fontFamily: Fonts.bodySemibold,
      fontSize: 15,
      color: colors.text,
    },
    meta: {
      fontFamily: Fonts.body,
      fontSize: 12.5,
      color: colors.neutral[500],
    },
    excerpt: {
      fontFamily: Fonts.body,
      fontSize: 14,
      lineHeight: 20,
      color: colors.text,
    },
    details: {
      fontFamily: Fonts.body,
      fontSize: 13.5,
      lineHeight: 19,
      color: colors.neutral[400],
    },
    mediaRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing[2],
    },
    thumb: {
      width: 96,
      height: 96,
      borderRadius: Radius.sm,
      backgroundColor: colors.surface,
    },
    link: {
      fontFamily: Fonts.bodySemibold,
      fontSize: 13.5,
      color: colors.text,
      textDecorationLine: 'underline',
    },
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing[2],
      marginTop: Spacing[2],
    },
    action: {
      paddingHorizontal: Spacing[4],
      height: 36,
      borderRadius: Radius.pill,
      borderWidth: 1,
      borderColor: colors.divider,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionDanger: {
      borderColor: colors.error,
    },
    actionText: {
      fontFamily: Fonts.bodySemibold,
      fontSize: 13.5,
      color: colors.text,
    },
    actionDangerText: {
      fontFamily: Fonts.bodySemibold,
      fontSize: 13.5,
      color: colors.error,
    },
    busy: {
      alignSelf: 'flex-start',
      marginTop: Spacing[2],
    },
    outcome: {
      marginTop: Spacing[1],
      fontFamily: Fonts.bodySemibold,
      fontSize: 13,
      color: colors.neutral[400],
    },
  });
