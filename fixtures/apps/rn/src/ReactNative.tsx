import React, { useEffect, useRef, useState } from 'react';
import { Dimensions, Keyboard, Pressable, StyleSheet, Text, TextInput, View, type HostInstance } from 'react-native';
import { formatted, type FieldFormat } from './format';
import type { Cell, Lab, Target } from './lab';

// The react-native family (fixtures/apps/cells/react-native.json): React Native's own text fields, which neither
// native lab app can build — calibration.json #18's field half (docs/bugs/2026-10-09-ios-wda-cell-background-and-
// textfield-scroll-bar-read-as-covers.md: mp-native's RN field lists its own scroll indicator, `container 'Horizontal
// scroll bar, 1 page'`, under the field over its floating label).
//
// `rn-field`: each target at its slot (Base.swift#Slot: 300×64, centred, its centre 142 + 180·slot down), on a box of
// its colour (`<tag>.box`), with a TextInput in it identified lab.<cell>.<tag>.field:
// - a text target (CatalogTarget.text): the field's floating label, laid as mp-native's SWIFT form lays its payee's
//   (its container 24,431 354x52, the label 42,446 103x22, the field 42,447 318x20): the label 18 pt in and 21 down,
//   the field 18 pt in on both sides and one point below the label's top, 20 tall, after the label in the order and
//   drawn over it (transparent). `M` the same with a MULTILINE TextInput (a UITextView on iOS, itself a scroll view),
//   laid as N's field (one point below the label's top, 20 tall) — the multiline neighbour. Its top lies below the
//   label's so the label comes first in the order (iOS lists RN's views by their frames' tops — lab note LR3, docs/bugs/
//   2026-10-19-lab-ios-wda-lists-react-native-views-by-their-frames-top-not-in-draw-order.md), and its height is the
//   SWIFT field's so its indicator lies where mp-native's does: WDA lists, under the text view (69,492 264x20), `Other
//   'Horizontal scroll bar, 1 page'` (value `0 %`, one bare thumb) at 69,499 264x10 — 7 pt below the field's top, 10
//   tall, as mp-native's 42,454 318x10 under its 42,447 field — over the label's centre (69,491 174x22, centre y 502):
//   #18's indicator. A tap on a label lands on its field: its focus logs the target's `tap`;
// - a label target (CatalogTarget.label): the field with an icon — a single-line TextInput and, at its trailing end, a
//   44-pt icon button labelled by the target's label (a white ×, identified lab.<cell>.<tag>, its frame `<tag>`): a
//   press logs the target's `tap` and empties the field.
// Every field reports its value and focus (the forms oracle, LabState.fields, by the target's tag), the keyboard its
// frame — what the live golden's forms cases judge a fill by.
//
// `rn-format` (D18): two text targets laid as rn-field's N, each field's onChangeText reformatting what it is handed
// (`format`, src/format.ts: G an IBAN grouped in fours, A an amount's thousands) — the model holds the formatted text,
// set back into the controlled TextInput, as a banking app's React Native form does.
//
// `rn-banner` (round 9, lab note LR3: docs/bugs/2026-10-19-lab-ios-wda-lists-react-native-views-by-their-frames-top-not-
// in-draw-order.md): each target a coloured Pressable filling its slot (a press logs its `tap`), and after it, its LATER
// JSX sibling, an opaque cover over its centre (`COVERS`, reported as `<tag>.cover`) — React Native draws it over the
// target, and it has no touch handler, so a touch on it reaches no target. T's and U's covers start 10 pt ABOVE the
// target's top: iOS lists RN's views by their tops, so the cover is listed BEFORE the target it is drawn over. T's is an
// accessible view labelled `Saved` (a toast); U's a bare View with an identifier only (lab.<cell>.U.cover). C's starts
// 10 pt BELOW its top — listed after it, the draw order and the listing agree: the control.
//
// `rn-banner-role` (Android only, backlog D77 sub-case b): rn-banner with each target and its cover inside a slot View
// carrying `accessibilityRole="toolbar"`, kept un-flattened (`collapsable={false}`) — React Native gives that role the
// accessibility className `android.view.View` (ReactAccessibilityDelegate.kt, AccessibilityRole.getValue), the class of
// a node provider's host; its children are React Native's ViewGroups, which tell it from one (docs/adr/0015-flat-list-
// reading-order-break.md, ADR 0015 residual 5). The slot ENCLOSES its cover (`ROLE_SLOT`: widened 20 pt left and
// right, 10 pt up and down, the target and the cover where rn-banner lays them on the screen): a slot as small as its
// target would clip the cover's dumped bounds to it (View#getBoundsOnScreen clips to each parent), which fails the
// location check alone, and the cell would not tell the role from the clip. Predicted: each target refused under its
// cover (ADR 0015 residual 5): tests/ui-tree/draw-order-android-views-twin.test.ts, P3.

export const SLOT = { width: 300, height: 64 };
const slotTop = (slot: number) => 142 + 180 * slot - SLOT.height / 2;
/** The multiline target's tag: its field is a multiline TextInput. */
const MULTILINE = 'M';

/** The cell whose targets lie under a later sibling (LR3). */
const BANNER = 'rn-banner';
/** rn-banner with each slot a View of accessibility role `toolbar` (D77). */
const BANNER_ROLE = 'rn-banner-role';
/** Whether the cell is an rn-banner: its targets lie under a later sibling, and none is a field. */
const isBanner = (cell: Cell) => cell.id === BANNER || cell.id === BANNER_ROLE;
/** rn-banner-role's slot around its target: as far out as the cover reaches (20 pt left and right, 10 pt up and down). */
const ROLE_SLOT = { x: 20, y: 10 };
/** A cover's left against its target's: 20 pt further left, so AOSP's location sort lists it first (D75). */
const COVER_LEFT = -20;
/** Each rn-banner target's cover, in the slot's coordinates: its top against the target's, and whether it is a labelled toast. */
const COVERS: Record<string, { top: number; label?: string }> = { T: { top: -10, label: 'Saved' }, U: { top: -10 }, C: { top: 10 } };

/** The fields of a cell: one per target (none in rn-banner and rn-banner-role, whose targets are no fields). */
export const fieldsOf = (cell: Cell) => (isBanner(cell) ? [] : cell.targets.map((t) => t.tag));

/** Reports a view's frame on the screen once it is laid out (and again whenever its layout changes). */
function useFrame(lab: Lab, tag: string) {
  const ref = useRef<HostInstance>(null);
  const onLayout = () => ref.current?.measureInWindow((x, y, width, height) => lab.frame(tag, { x, y, width, height }));
  return { ref, onLayout };
}

export function ReactNativeScreen({ cell, lab }: { cell: Cell; lab: Lab }) {
  useEffect(() => {
    // The keyboard's end frame (iOS: will-change, its frame as it ends; Android: did-show / did-hide).
    const report = (e: { endCoordinates: { screenX: number; screenY: number; width: number; height: number } }) => {
      const k = e.endCoordinates;
      lab.keyboard({ x: k.screenX, y: k.screenY, width: k.width, height: k.height });
    };
    const hidden = () => lab.keyboard({ x: 0, y: Dimensions.get('screen').height, width: Dimensions.get('screen').width, height: 0 });
    const subs = [Keyboard.addListener('keyboardWillChangeFrame', report), Keyboard.addListener('keyboardDidShow', report), Keyboard.addListener('keyboardDidHide', hidden)];
    // As the native apps: settled once laid out and given time to draw.
    const settle = setTimeout(() => lab.settled(), 800);
    return () => {
      clearTimeout(settle);
      subs.forEach((s) => s.remove());
    };
  }, [lab]);
  const width = Dimensions.get('screen').width;
  return (
    <View style={styles.screen}>
      {cell.targets.map((t) =>
        cell.id === BANNER_ROLE ? (
          <View
            key={t.tag}
            testID={`lab.${cell.id}.${t.tag}.slot`}
            accessibilityRole="toolbar"
            collapsable={false}
            style={[styles.roleSlot, { left: (width - SLOT.width) / 2 - ROLE_SLOT.x, top: slotTop(t.slot) - ROLE_SLOT.y }]}>
            <CoveredTarget cell={cell} target={t} lab={lab} inset={ROLE_SLOT} />
          </View>
        ) : (
          <View key={t.tag} style={[styles.slot, { left: (width - SLOT.width) / 2, top: slotTop(t.slot) }]}>
            {isBanner(cell) ? <CoveredTarget cell={cell} target={t} lab={lab} /> : t.label !== undefined ? <IconField cell={cell} target={t} lab={lab} /> : <LabelledField cell={cell} target={t} lab={lab} />}
          </View>
        ),
      )}
    </View>
  );
}

/**
 * The model's side of a field: its value and focus reported, a focus logging the target's `tap` when `tapOnFocus`; with
 * a `format`, every change reformatted before the model takes it.
 */
function useField(lab: Lab, tag: string, tapOnFocus: boolean, format?: FieldFormat) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  useEffect(() => lab.field(tag, value, focused), [lab, tag, value, focused]);
  return {
    value,
    clear: () => setValue(''),
    props: {
      value,
      onChangeText: (text: string) => setValue(formatted(format, text)),
      onFocus: () => {
        setFocused(true);
        lab.focused(tag);
        if (tapOnFocus) lab.event('tap', tag);
      },
      onBlur: () => {
        setFocused(false);
        lab.focused(null);
      },
    },
  };
}

/** A text target: the floating label beneath its transparent field (single-line, or `M`'s multiline). */
function LabelledField({ cell, target, lab }: { cell: Cell; target: Target; lab: Lab }) {
  const id = `lab.${cell.id}.${target.tag}`;
  const box = useFrame(lab, `${target.tag}.box`);
  const label = useFrame(lab, target.tag);
  const field = useField(lab, target.tag, true, target.format);
  const multiline = target.tag === MULTILINE;
  return (
    <View testID={`${id}.box`} ref={box.ref} onLayout={box.onLayout} style={[styles.box, { backgroundColor: target.color }]}>
      <Text testID={id} ref={label.ref} onLayout={label.onLayout} style={styles.label}>
        {target.text}
      </Text>
      <TextInput
        testID={`${id}.field`}
        style={multiline ? styles.multiline : styles.line}
        multiline={multiline}
        autoCorrect={false}
        autoCapitalize="none"
        underlineColorAndroid="transparent"
        {...field.props}
      />
    </View>
  );
}

/** A label target: a field with a trailing icon button labelled by the target's label. */
function IconField({ cell, target, lab }: { cell: Cell; target: Target; lab: Lab }) {
  const id = `lab.${cell.id}.${target.tag}`;
  const box = useFrame(lab, `${target.tag}.box`);
  const icon = useFrame(lab, target.tag);
  const field = useField(lab, target.tag, false);
  return (
    <View testID={`${id}.box`} ref={box.ref} onLayout={box.onLayout} style={[styles.box, { backgroundColor: target.color }]}>
      <TextInput testID={`${id}.field`} style={[styles.line, styles.beforeIcon]} autoCorrect={false} autoCapitalize="none" underlineColorAndroid="transparent" {...field.props} />
      <Pressable
        testID={id}
        ref={icon.ref}
        onLayout={icon.onLayout}
        accessibilityRole="button"
        accessibilityLabel={target.label}
        style={[styles.icon, { backgroundColor: target.color }]}
        onPress={() => {
          lab.event('tap', target.tag);
          field.clear();
        }}>
        <Text style={styles.glyph}>×</Text>
      </Pressable>
    </View>
  );
}

/**
 * An rn-banner target: a coloured Pressable, then its cover (`COVERS`) drawn over its centre. `inset`: where the target
 * lies in a slot wider than it (rn-banner-role's `ROLE_SLOT`); without it the target fills its slot.
 */
function CoveredTarget({ cell, target, lab, inset }: { cell: Cell; target: Target; lab: Lab; inset?: { x: number; y: number } }) {
  const id = `lab.${cell.id}.${target.tag}`;
  const own = useFrame(lab, target.tag);
  const coverFrame = useFrame(lab, `${target.tag}.cover`);
  const cover = COVERS[target.tag] ?? { top: -10 };
  return (
    <>
      <Pressable
        testID={id}
        ref={own.ref}
        onLayout={own.onLayout}
        style={[inset === undefined ? styles.box : [styles.inSlot, { left: inset.x, top: inset.y }], { backgroundColor: target.color }]}
        onPress={() => lab.event('tap', target.tag)}
      />
      <View
        testID={`${id}.cover`}
        ref={coverFrame.ref}
        onLayout={coverFrame.onLayout}
        accessible={cover.label !== undefined}
        {...(cover.label !== undefined && { accessibilityLabel: cover.label })}
        style={[styles.cover, { top: cover.top + (inset?.y ?? 0), left: COVER_LEFT + (inset?.x ?? 0) }]}>
        {cover.label !== undefined ? <Text style={styles.toast}>{cover.label}</Text> : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  slot: { position: 'absolute', width: SLOT.width, height: SLOT.height },
  box: { flex: 1 },
  label: { position: 'absolute', left: 18, top: 21, fontSize: 15, lineHeight: 22, color: '#1F2933' },
  line: { position: 'absolute', left: 18, right: 18, top: 22, height: 20, padding: 0, margin: 0, fontSize: 15, color: '#1F2933', backgroundColor: 'transparent' },
  beforeIcon: { right: 62, color: '#FFFFFF' },
  multiline: { position: 'absolute', left: 18, right: 18, top: 22, height: 20, paddingTop: 0, paddingBottom: 0, paddingHorizontal: 0, margin: 0, fontSize: 15, color: '#1F2933', backgroundColor: 'transparent', textAlignVertical: 'top' },
  icon: { position: 'absolute', right: 10, top: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  glyph: { color: '#FFFFFF', fontSize: 24, lineHeight: 28 },
  inSlot: { position: 'absolute', width: SLOT.width, height: SLOT.height },
  roleSlot: { position: 'absolute', width: SLOT.width + 2 * ROLE_SLOT.x, height: SLOT.height + 2 * ROLE_SLOT.y },
  cover: { position: 'absolute', width: 340, height: 52, backgroundColor: '#263238', justifyContent: 'center', paddingLeft: 16 },
  toast: { color: '#FFFFFF', fontSize: 15 },
});
