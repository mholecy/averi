import React, { useEffect, useRef, useState } from 'react';
import { Dimensions, Keyboard, Pressable, StyleSheet, Text, TextInput, View, type HostInstance } from 'react-native';
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
//   drawn over it (transparent). `M` the same with a MULTILINE TextInput (a UITextView on iOS, itself a scroll view)
//   running the box's height, the label inside it — the multiline neighbour. A tap on the label lands on the field:
//   its focus logs the target's `tap`;
// - a label target (CatalogTarget.label): the field with an icon — a single-line TextInput and, at its trailing end, a
//   44-pt icon button labelled by the target's label (a white ×, identified lab.<cell>.<tag>, its frame `<tag>`): a
//   press logs the target's `tap` and empties the field.
// Every field reports its value and focus (the forms oracle, LabState.fields, by the target's tag), the keyboard its
// frame — what the live golden's forms cases judge a fill by.

export const SLOT = { width: 300, height: 64 };
const slotTop = (slot: number) => 142 + 180 * slot - SLOT.height / 2;
/** The multiline target's tag: its field is a multiline TextInput. */
const MULTILINE = 'M';

/** The fields of a cell: one per target. */
export const fieldsOf = (cell: Cell) => cell.targets.map((t) => t.tag);

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
      {cell.targets.map((t) => (
        <View key={t.tag} style={[styles.slot, { left: (width - SLOT.width) / 2, top: slotTop(t.slot) }]}>
          {t.label !== undefined ? <IconField cell={cell} target={t} lab={lab} /> : <LabelledField cell={cell} target={t} lab={lab} />}
        </View>
      ))}
    </View>
  );
}

/** The model's side of a field: its value and focus reported, a focus logging the target's `tap` when `tapOnFocus`. */
function useField(lab: Lab, tag: string, tapOnFocus: boolean) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  useEffect(() => lab.field(tag, value, focused), [lab, tag, value, focused]);
  return {
    value,
    clear: () => setValue(''),
    props: {
      value,
      onChangeText: setValue,
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
  const field = useField(lab, target.tag, true);
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  slot: { position: 'absolute', width: SLOT.width, height: SLOT.height },
  box: { flex: 1 },
  label: { position: 'absolute', left: 18, top: 21, fontSize: 15, lineHeight: 22, color: '#1F2933' },
  line: { position: 'absolute', left: 18, right: 18, top: 22, height: 20, padding: 0, margin: 0, fontSize: 15, color: '#1F2933', backgroundColor: 'transparent' },
  beforeIcon: { right: 62, color: '#FFFFFF' },
  multiline: { position: 'absolute', left: 18, right: 18, top: 4, bottom: 4, paddingTop: 18, paddingBottom: 0, paddingHorizontal: 0, margin: 0, fontSize: 15, color: '#1F2933', backgroundColor: 'transparent', textAlignVertical: 'top' },
  icon: { position: 'absolute', right: 10, top: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  glyph: { color: '#FFFFFF', fontSize: 24, lineHeight: 28 },
});
