import { Link, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BottomTabInset, Colors, Fonts, Spacing } from '@/constants/theme';
import Icon from './Icon';

// Ported from app_reference/src/components/TabBar.jsx. Not an Expo Router
// `Tabs` layout — like the mock, this is a plain component each top-level
// screen renders itself, since its destinations depend on the *current*
// Room/user, not a fixed set of routes Expo Router's tab primitive expects.
type TabLabel = 'Home' | 'Explore' | 'Post' | 'Chats' | 'You';

type TabBarProps = {
  active: TabLabel;
  /** Current Room id — the Home tab falls back to "/" and Post is disabled without one. */
  communityId?: string;
  userId: string;
};

function useTabs(communityId: string | undefined, userId: string): { label: TabLabel; icon: 'homeTab' | 'exploreTab' | 'postTab' | 'chatsTab' | 'youTab'; href?: Href }[] {
  return [
    { label: 'Home', icon: 'homeTab', href: communityId ? { pathname: '/c/[communityId]', params: { communityId } } : '/' },
    { label: 'Explore', icon: 'exploreTab', href: '/discover' },
    { label: 'Post', icon: 'postTab', href: communityId ? { pathname: '/c/[communityId]/create-post', params: { communityId } } : undefined },
    { label: 'Chats', icon: 'chatsTab', href: '/chats' },
    { label: 'You', icon: 'youTab', href: { pathname: '/u/[userId]', params: { userId } } },
  ];
}

export default function TabBar({ active, communityId, userId }: TabBarProps) {
  const tabs = useTabs(communityId, userId);

  return (
    <View style={styles.bar}>
      {tabs.map((tab) => {
        const isActive = tab.label === active;
        const color = isActive ? Colors.accent.DEFAULT : `${Colors.text}6B`;
        const content = (
          <View style={styles.tabContent}>
            <Icon name={tab.icon} size={24} color={color} />
            <Text style={[styles.label, { color }]}>{tab.label}</Text>
            <View style={[styles.dot, isActive && { backgroundColor: Colors.accent.DEFAULT }]} />
          </View>
        );

        if (!tab.href) {
          return (
            <View key={tab.label} style={styles.tab}>
              {content}
            </View>
          );
        }

        return (
          <Link key={tab.label} href={tab.href} asChild style={styles.tab}>
            <Pressable>{content}</Pressable>
          </Link>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 2,
    paddingTop: Spacing[3],
    paddingHorizontal: Spacing[4],
    paddingBottom: BottomTabInset,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
  },
  tab: {
    flex: 1,
  },
  tabContent: {
    alignItems: 'center',
    gap: 5,
    paddingTop: 6,
  },
  label: {
    fontFamily: Fonts?.bodyBold,
    fontSize: 9.5,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 999,
    backgroundColor: 'transparent',
  },
});
