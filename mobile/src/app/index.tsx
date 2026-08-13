import { StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';

// Phase 0 placeholder — real navigation/screens land in Phase 3, mirroring
// app_reference's routes (Rooms, Discover, Chats, ...). This screen only
// exists to prove the ported design tokens render correctly end to end.
export default function Index() {
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Chasien</Text>
      <Text style={styles.body}>Phase 0 skeleton — see docs/roadmap.md</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.bg,
  },
  heading: {
    fontFamily: Fonts?.heading,
    fontSize: 32,
    color: Colors.text,
  },
  body: {
    fontFamily: Fonts?.body,
    fontSize: 14,
    color: Colors.neutral[400],
  },
});
