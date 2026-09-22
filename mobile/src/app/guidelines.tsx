import { router } from 'expo-router';
import { useMemo } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Icon from '@/components/Icon';
import { SUPPORT_EMAIL } from '@/constants/contact';
import { Fonts, MaxContentWidth, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { emailSupport } from '@/lib/support';

const LAST_UPDATED = '22 September 2026';

type Section = {
  title: string;
  paragraphs?: string[];
  /** Bold lead-in, then the explanation. */
  rules?: { name: string; text: string }[];
};

// Kept as data so the same text can go on the download page later (APK
// Beta Phase). Only describe what the app actually does: Apple reviews
// this against the app, and a promise the product can't keep is worse
// than a plainer sentence.
const SECTIONS: Section[] = [
  {
    title: 'Zero tolerance',
    paragraphs: [
      'Chasien has zero tolerance for objectionable content and abusive users. Content that breaks these guidelines is removed, and accounts that break them can be suspended, without warning in serious cases.',
      'You need to be at least 16 to use Chasien.',
    ],
  },
  {
    title: "What isn't allowed",
    rules: [
      {
        name: 'Hate',
        text: 'Slurs, or attacking people for their race, ethnicity, nationality, religion, caste, disability, sex, gender identity or sexual orientation.',
      },
      { name: 'Harassment and bullying', text: 'Targeting, threatening, intimidating or humiliating someone, or getting others to.' },
      { name: 'Violence', text: 'Threatening violence, or praising or encouraging violence or terrorism.' },
      {
        name: 'Sexual content',
        text: 'Sexually explicit images or text, and anything that sexualizes a minor. Child sexual abuse material is removed and may be reported to law enforcement.',
      },
      {
        name: 'Self-harm',
        text: "Encouraging suicide, self-harm or eating disorders. Talking about your own struggles is okay; if someone is in danger, contact local emergency services.",
      },
      { name: 'Illegal activity', text: 'Selling or promoting illegal goods or services, or helping others break the law.' },
      { name: 'Spam and scams', text: "Repeated unwanted promotion, fake giveaways, or trying to get people's money, passwords or personal details." },
      { name: 'Impersonation', text: 'Pretending to be another person, brand or organization in a way that misleads people.' },
      { name: 'Private information', text: "Posting someone's address, phone number, private photos or messages without their consent." },
    ],
  },
  {
    title: 'Rooms and moderators',
    paragraphs: [
      "A Room's owner, admins and moderators look after that Room. They can remove posts, comments and messages, mute people in its chats, and remove members. A Room can add its own rules, but it can't allow anything these guidelines don't.",
      "The Chasien team can remove content and suspend accounts anywhere, including a Room's owner.",
    ],
  },
  {
    title: 'Reporting and blocking',
    paragraphs: [
      "If you see something that breaks these guidelines, report it: use the options menu on a post, story or profile, press and hold a chat message, tap Report under a comment, or choose Report this Room in a Room's settings. Reports go to the Chasien team, and the person you report isn't told who reported them.",
      "You can also block anyone. Once you do, they can't see your posts, comments or stories or message you directly, and you won't see theirs.",
    ],
  },
  {
    title: 'If you break these guidelines',
    paragraphs: [
      "We remove content that breaks them. Depending on how serious it is, we can also suspend your account, which stops you signing in. If you think we've made a mistake, email us and tell us why.",
    ],
  },
  {
    title: 'Deleting your account',
    paragraphs: [
      'You can delete your account at any time in Settings, under Delete account. It is permanent: your profile, posts, comments, stories and chat messages are deleted, along with your direct message conversations. Each Room you own passes to its longest-standing admin, then moderator, then member, or is deleted if nobody else is in it.',
      `Can't use the app? Email ${SUPPORT_EMAIL} from the address you signed up with and ask us to delete your account. We'll delete it within 30 days.`,
      'Reports you filed stay, without your name, and reports about you keep what was reported, as a safety record.',
    ],
  },
];

/**
 * The community guidelines people accept at signup (Apple 1.2 expects
 * users to agree to terms with no tolerance for objectionable content or
 * abusive users). Readable signed in or out: signup links here before an
 * account exists, so AuthGate lets this route through either way.
 */
export default function Guidelines() {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  function handleEmail() {
    emailSupport().then((opened) => {
      if (!opened) Alert.alert('Email us', SUPPORT_EMAIL);
    });
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          style={styles.headerSide}
          hitSlop={8}
          // Opened by a direct link there's nothing to go back to; "/"
          // sends a signed-out visitor on to login anyway.
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Icon name="back" size={22} color={colors.text} strokeWidth={2.4} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Community guidelines
        </Text>
        <View style={styles.headerSide} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          Chasien is made of Rooms: communities with their own people, posts and chat. These guidelines apply everywhere in
          Chasien, in every Room. By using Chasien you agree to follow them.
        </Text>

        {SECTIONS.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {section.paragraphs?.map((p) => (
              <Text key={p} style={styles.paragraph}>
                {p}
              </Text>
            ))}
            {section.rules?.map((rule) => (
              <View key={rule.name} style={styles.rule}>
                <Text style={styles.bullet}>•</Text>
                <Text style={[styles.paragraph, styles.ruleText]}>
                  <Text style={styles.ruleName}>{rule.name}. </Text>
                  {rule.text}
                </Text>
              </View>
            ))}
          </View>
        ))}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contact us</Text>
          <Text style={styles.paragraph}>
            To report something you can&apos;t report in the app, appeal a suspension, or ask us anything else, email{' '}
            <Text style={styles.link} onPress={handleEmail} accessibilityRole="link">
              {SUPPORT_EMAIL}
            </Text>
            .
          </Text>
        </View>

        <Text style={styles.updated}>Last updated {LAST_UPDATED}</Text>
      </ScrollView>
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
    content: {
      paddingHorizontal: Spacing[6],
      paddingBottom: Spacing[8],
      width: '100%',
      maxWidth: MaxContentWidth,
      alignSelf: 'center',
    },
    intro: {
      marginTop: Spacing[2],
      fontFamily: Fonts.body,
      fontSize: 15,
      lineHeight: 22,
      color: colors.text,
    },
    section: {
      marginTop: Spacing[6],
      gap: Spacing[2],
    },
    sectionTitle: {
      fontFamily: Fonts.bodyBold,
      fontSize: 16,
      color: colors.text,
    },
    // neutral[700], not the [400] used for short captions elsewhere: this
    // is several screens of reading, and [400] is about 2:1 on white.
    // [700] is about 9:1 in both themes (the ramp flips in Dark).
    paragraph: {
      fontFamily: Fonts.body,
      fontSize: 15,
      lineHeight: 22,
      color: colors.neutral[700],
    },
    rule: {
      flexDirection: 'row',
      gap: Spacing[2],
    },
    // Beside the bullet, so it takes the rest of the row and wraps.
    ruleText: {
      flex: 1,
    },
    bullet: {
      fontFamily: Fonts.body,
      fontSize: 15,
      lineHeight: 22,
      color: colors.neutral[700],
    },
    ruleName: {
      fontFamily: Fonts.bodyBold,
      color: colors.text,
    },
    link: {
      fontFamily: Fonts.bodySemibold,
      color: colors.text,
      textDecorationLine: 'underline',
    },
    updated: {
      marginTop: Spacing[8],
      fontFamily: Fonts.body,
      fontSize: 12.5,
      color: colors.neutral[600],
    },
  });
