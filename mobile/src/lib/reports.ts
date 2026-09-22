import { FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

/**
 * Reporting and report review (Phase 9). See
 * 20260921120100_reports.sql: a report is one INSERT, and the server does
 * the rest — validates the reporter could see what they're reporting,
 * captures a snapshot of it (the client can't supply one), and notifies
 * every app admin. Review is app-admin-only: RLS for reading, resolve_report()
 * for the outcome, the slice-2 removal functions for content, and the
 * `moderate` Edge Function for suspensions and viewing reported media.
 */

export type ReportTargetType = 'post' | 'comment' | 'message' | 'story' | 'user' | 'room';

/** Must match the reports_reason_known constraint and REASON_LABEL in notify-activity. */
export type ReportReason = 'spam' | 'harassment' | 'hate' | 'sexual' | 'violence' | 'self_harm' | 'illegal' | 'other';

export const REPORT_REASONS: { key: ReportReason; label: string }[] = [
  { key: 'spam', label: 'Spam' },
  { key: 'harassment', label: 'Harassment or bullying' },
  { key: 'hate', label: 'Hate speech' },
  { key: 'sexual', label: 'Nudity or sexual content' },
  { key: 'violence', label: 'Violence or threats' },
  { key: 'self_harm', label: 'Self-harm' },
  { key: 'illegal', label: 'Something illegal' },
  { key: 'other', label: 'Something else' },
];

export function reasonLabel(reason: string): string {
  return REPORT_REASONS.find((r) => r.key === reason)?.label ?? reason;
}

/** Postgres unique_violation — here, reports_one_open_per_reporter. */
const UNIQUE_VIOLATION = '23505';

export async function fileReport(
  myId: string,
  targetType: ReportTargetType,
  targetId: string,
  reason: ReportReason,
  details: string,
): Promise<void> {
  const trimmed = details.trim();
  const { error } = await supabase.from('reports').insert({
    reporter_id: myId,
    target_type: targetType,
    target_id: targetId,
    reason,
    details: trimmed.length > 0 ? trimmed : null,
  });
  if (error?.code === UNIQUE_VIOLATION) {
    throw new Error("You've already reported this — it's waiting for review.");
  }
  if (error) throw error;
}

/** Whether the signed-in user is an app admin. Only ever answers about the caller. */
export async function fetchAmIAppAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('current_user_is_app_admin');
  if (error) throw error;
  return data === true;
}

// ── App-admin review ────────────────────────────────────────────────────

/** What the server captured when the report was filed. Which fields exist depends on the target type. */
export type ReportSnapshot = {
  text?: string | null;
  caption?: string | null;
  name?: string | null;
  handle?: string | null;
  bio?: string | null;
  description?: string | null;
  author_id?: string | null;
  author_handle?: string | null;
  room_id?: string | null;
  room_name?: string | null;
  media?: string[];
  media_url?: string | null;
  image_url?: string | null;
  voice_url?: string | null;
};

export type AdminReport = {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  details: string | null;
  status: 'open' | 'reviewed' | 'actioned' | 'dismissed';
  createdAt: string;
  reviewedAt: string | null;
  reporterHandle: string | null;
  snapshot: ReportSnapshot;
};

const REPORT_SELECT =
  'id, target_type, target_id, reason, details, status, created_at, reviewed_at, content_snapshot, reporter:profiles!reports_reporter_id_fkey(handle)';

function mapReport(row: Record<string, unknown>): AdminReport {
  const reporter = row.reporter as { handle: string } | null;
  return {
    id: row.id as string,
    targetType: row.target_type as ReportTargetType,
    targetId: row.target_id as string,
    reason: row.reason as string,
    details: row.details as string | null,
    status: row.status as AdminReport['status'],
    createdAt: row.created_at as string,
    reviewedAt: row.reviewed_at as string | null,
    reporterHandle: reporter?.handle ?? null,
    snapshot: (row.content_snapshot ?? {}) as ReportSnapshot,
  };
}

/** Open reports oldest first (a queue), or the 50 most recently resolved. RLS returns every report only to app admins. */
export async function fetchReports(which: 'open' | 'resolved'): Promise<AdminReport[]> {
  const query =
    which === 'open'
      ? supabase.from('reports').select(REPORT_SELECT).eq('status', 'open').order('created_at', { ascending: true })
      : supabase.from('reports').select(REPORT_SELECT).neq('status', 'open').order('reviewed_at', { ascending: false }).limit(50);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => mapReport(row as Record<string, unknown>));
}

/** Records the outcome. The action itself (removing, suspending) is a separate call. */
export async function resolveReport(reportId: string, status: 'dismissed' | 'actioned'): Promise<void> {
  const { error } = await supabase.rpc('resolve_report', { p_report_id: reportId, p_status: status });
  if (error) throw error;
}

async function callModerate(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('moderate', { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const parsed = (await error.context.json().catch(() => null)) as { error?: string } | null;
      throw new Error(parsed?.error ?? error.message);
    }
    throw new Error(error.message);
  }
  return data;
}

/** Bans the account in Supabase Auth and records the suspension; with a reportId, marks that report actioned. */
export function suspendUser(userId: string, reason: string | null, reportId?: string) {
  return callModerate({ action: 'suspend_user', user_id: userId, reason: reason ?? undefined, report_id: reportId });
}

export function unsuspendUser(userId: string) {
  return callModerate({ action: 'unsuspend_user', user_id: userId });
}

/**
 * Short-lived signed URLs for the media a report captured; a deleted object
 * comes back with url null. The function returns only each URL's path and
 * token (its own idea of the Supabase address is the Docker-internal one
 * locally), so the full URL is built from this app's own Supabase URL.
 */
export async function signReportMedia(reportId: string): Promise<{ path: string; url: string | null }[]> {
  const data = (await callModerate({ action: 'sign_report_media', report_id: reportId })) as {
    media?: { path: string; signedPath: string | null }[];
  } | null;
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  return (data?.media ?? []).map((m) => ({ path: m.path, url: m.signedPath ? `${base}${m.signedPath}` : null }));
}

export type Suspension = { userId: string; handle: string; name: string; reason: string | null; createdAt: string };

export async function fetchSuspensions(): Promise<Suspension[]> {
  const { data, error } = await supabase
    .from('account_suspensions')
    .select('user_id, reason, created_at, profile:profiles!account_suspensions_user_id_fkey(handle, name)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => {
    const profile = row.profile as unknown as { handle: string; name: string } | null;
    return {
      userId: row.user_id as string,
      handle: profile?.handle ?? 'unknown',
      name: profile?.name ?? 'Deleted user',
      reason: row.reason as string | null,
      createdAt: row.created_at as string,
    };
  });
}
