package dev.averi.lab

import androidx.compose.runtime.Composable

// The bars family (fixtures/apps/cells/bars.json): the status and navigation bands, a floating or hidden tab bar, a FAB
// — phase 3's B4 builds its cells here, on the coloured-target pieces of Base.kt (TargetBox, the slots), reporting what
// its geometry needs in the state (Lab.kt: safeArea, scrollViews, chrome).

@Composable
internal fun BarsScreen(cell: Cell, lab: Lab) {
    UnbuiltCell(cell)
}
