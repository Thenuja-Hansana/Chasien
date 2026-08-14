import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Icon from '@/components/Icon';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

// Real-time messaging is Phase 6. Since there's no conversation data yet,
// any chatId here is by definition one the account can't actually reach —
// this proves the route and back-navigation, nothing more.
export default function ChatView() {
  const { chatId } = useLocalSearchParams<{ chatId: string }>();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Icon name="back" size={22} color={Colors.text} />
        </Pressable>
        <Text style={styles.headingText} numberOfLines={1}>
          {chatId}
        </Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.empty}>
        <Text style={styles.body}>This conversation isn&apos;t available yet.</Text>
      </View>

      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          placeholder="Message"
          placeholderTextColor={Colors.neutral[500]}
          editable={false}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing[3],
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[3],
    paddingBottom: Spacing[4],
  },
  headingText: {
    flex: 1,
    fontFamily: Fonts?.heading,
    fontSize: 16,
    color: Colors.text,
    textAlign: 'center',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing[6],
  },
  body: {
    fontFamily: Fonts?.body,
    fontSize: 14,
    color: Colors.neutral[400],
    textAlign: 'center',
  },
  inputBar: {
    paddingHorizontal: Spacing[4],
    paddingBottom: Spacing[6],
  },
  input: {
    height: 46,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.divider,
    paddingHorizontal: 18,
    fontSize: 15,
    color: Colors.text,
    fontFamily: Fonts?.body,
    opacity: 0.5,
  },
});
