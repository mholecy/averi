package dev.averi.lab

import androidx.compose.runtime.Composable

// The false-covers family (fixtures/apps/cells/false-covers.json): a target's own parts (a Compose button's text), a bar that is no cover — phase 3's B5 builds its cells here, on the
// coloured-target pieces of Base.kt (TargetBox, the slots), reporting what its geometry needs in the state (Lab.kt:
// safeArea, scrollViews, chrome).

@Composable
internal fun FalseCoversScreen(cell: Cell, lab: Lab) {
    UnbuiltCell(cell)
}
