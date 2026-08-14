import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Icon from '@/components/Icon';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

// Actually creating a Room is Phase 4's "Create Room flow" (owner
// assignment, RLS-backed writes). This is the reachable shell: the name
// field is local-only and Create is disabled until that's wired up.
export default function CreateCommunity() {
  const [name, setName] = useState('');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Icon name="close" size={22} color={Colors.text} />
        </Pressable>
        <Text style={styles.headingText}>New Room</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.content}>
        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Your Room's name"
          placeholderTextColor={Colors.neutral[500]}
        />
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerNote}>Creating Rooms for real arrives in Phase 4.</Text>
        <View style={[styles.submitButton, styles.submitButtonDisabled]}>
          <Text style={styles.submitButtonText}>Create Room</Text>
        </View>
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
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[3],
    paddingBottom: Spacing[4],
  },
  headingText: {
    fontFamily: Fonts?.heading,
    fontSize: 17,
    color: Colors.text,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing[6],
  },
  label: {
    fontFamily: Fonts?.body,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: Colors.neutral[500],
    marginBottom: Spacing[2],
  },
  input: {
    height: 52,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.divider,
    paddingHorizontal: 20,
    fontSize: 15,
    color: Colors.text,
    fontFamily: Fonts?.body,
  },
  footer: {
    paddingHorizontal: Spacing[6],
    paddingBottom: Spacing[8],
    gap: Spacing[3],
  },
  footerNote: {
    fontFamily: Fonts?.body,
    fontSize: 12,
    color: Colors.neutral[500],
    textAlign: 'center',
  },
  submitButton: {
    height: 54,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accent.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.4,
  },
  submitButtonText: {
    fontFamily: Fonts?.heading,
    fontSize: 16,
    color: Colors.bg,
  },
});
