import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CELLS, Lab } from './src/lab';
import { fieldsOf, ReactNativeScreen } from './src/ReactNative';

// The React Native lab app (README.md; docs/plans/2026-10-15-ground-truth-lab-app.md, round 7): one cell of
// fixtures/apps/cells.json per launch, chosen by the launch argument `-cell <id>` (iOS) or the intent extra `cell`
// (Android), handed in as the root's initial property `cell`. It builds the react-native family alone
// (src/ReactNative.tsx); any other cell is said on screen and never ready — a capture of it times out naming the cell.

export default function App({ cell = '' }: { cell?: string }) {
  const found = CELLS.find((c) => c.id === cell);
  const built = found?.family === 'react-native' ? found : undefined;
  const lab = useMemo(() => new Lab(cell, found, built === undefined ? [] : fieldsOf(built)), [cell, found, built]);
  if (built !== undefined) return <ReactNativeScreen cell={built} lab={lab} />;
  return (
    <View style={styles.unbuilt}>
      <Text>{cell === '' ? 'AveriLabRN: launch with a cell (README.md)' : `Cell ${cell}: this app builds the react-native family only`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  unbuilt: { flex: 1, padding: 24, paddingTop: 80, backgroundColor: '#FFFFFF' },
});
