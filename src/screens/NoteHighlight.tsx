import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ChangedRange, isPureDeletion, splitAroundRange } from "../notes/changedRange";
import { Palette } from "../theme/palette";
import { useTheme } from "../theme/ThemeContext";

/** Leaves the change a little below the top edge instead of flush against it. */
const SCROLL_LEAD = 72;

type Props = {
  body: string;
  range: ChangedRange;
  onDismiss: () => void;
};

/**
 * The note shown read-only with the agent's latest change tinted, replacing the
 * editor for the few seconds a highlight is up (PRD §7.5).
 *
 * A separate view rather than styling inside the editor, because a range of a
 * controlled `TextInput`'s value can't be styled — and because owning the
 * `ScrollView` is what makes scrolling to the change possible at all.
 *
 * Any tap dismisses it and hands editing straight back, so this never stands
 * between the user and typing for longer than they want.
 */
export function NoteHighlight({ body, range, onDismiss }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const scrollRef = useRef<ScrollView>(null);
  const [changeY, setChangeY] = useState<number | null>(null);

  const split = useMemo(() => splitAroundRange(body, range), [body, range]);
  const deletion = isPureDeletion(range);

  useEffect(() => {
    if (changeY === null) return;
    scrollRef.current?.scrollTo({ y: Math.max(0, changeY - SCROLL_LEAD), animated: true });
  }, [changeY]);

  return (
    <Pressable style={styles.container} onPress={onDismiss} accessibilityLabel="Dismiss the change highlight">
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {split.head !== "" && <Text style={styles.body}>{split.head}</Text>}

        {/* Its own block purely so `onLayout` reports where the change is. */}
        <Text style={styles.body} onLayout={(event) => setChangeY(event.nativeEvent.layout.y)}>
          {split.mid.slice(0, split.midRange.start)}
          {deletion ? (
            // Nothing was inserted, so there is nothing to tint. A small mark
            // says "something was removed here" without resurrecting the text
            // or turning the note into a review tool.
            <Text style={styles.deletionMark}> </Text>
          ) : (
            <Text style={styles.inserted}>{split.mid.slice(split.midRange.start, split.midRange.end)}</Text>
          )}
          {split.mid.slice(split.midRange.end)}
        </Text>

        {split.tail !== "" && <Text style={styles.body}>{split.tail}</Text>}
        <View style={styles.bottomSpacer} />
      </ScrollView>
    </Pressable>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1 },
    content: { padding: 16 },
    // Must match NoteEditorScreen's TextInput, or swapping back on dismiss
    // visibly reflows the note.
    body: { fontSize: 16, color: colors.text },
    inserted: { backgroundColor: colors.accentSurface },
    deletionMark: { backgroundColor: colors.accent, color: colors.accent },
    /** Clears the floating button cluster, which overlays the bottom of the note. */
    bottomSpacer: { height: 160 },
  });
