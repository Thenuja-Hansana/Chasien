import type { RoomVisibility } from '@/lib/rooms';

export type JoinTypeOption = {
  key: RoomVisibility;
  icon: 'globe' | 'lock' | 'mail' | 'clock' | 'checkDouble';
  title: string;
  desc: string;
};

/**
 * "Who can join" is a two-step choice, not one flat list: Public is its
 * own top-level pick (nothing more to configure), while every other
 * visibility is a *kind* of Private — picking Private reveals these
 * three as a nested sub-list rather than sitting flush with Public in
 * one radio group. Shared by Room creation and Room settings so the two
 * forms can't drift apart on what "who can join" actually offers.
 */
export const PUBLIC_OPTION: JoinTypeOption = {
  key: 'public',
  icon: 'globe',
  title: 'Public',
  desc: 'Listed in Discover, anyone joins instantly',
};

export const PRIVATE_JOIN_TYPES: JoinTypeOption[] = [
  { key: 'request', icon: 'clock', title: 'Request to join', desc: 'Listed, but mods approve' },
  { key: 'invite', icon: 'mail', title: 'Invite only', desc: 'Hidden from Discover' },
  // Not a manual mod approval like Request — joining means proving control
  // of an email address on a domain the owner sets below (e.g. a
  // university or company's), via a real emailed link. See
  // lib/domainVerification.ts and the request-room-verification /
  // verify-room-email Edge Functions.
  { key: 'domain_verified', icon: 'checkDouble', title: 'Domain Verified', desc: 'Anyone with a matching email domain joins' },
];

export function isValidDomain(domain: string) {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain.trim().toLowerCase());
}
