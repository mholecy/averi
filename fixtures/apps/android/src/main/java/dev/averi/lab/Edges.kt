package dev.averi.lab

import androidx.compose.runtime.Composable

// The edges family (fixtures/apps/cells/edges.json): a target cut, a sliver, outside its scroll view's clip, under a sticky header, off the screen — phase 3's B2 builds its cells here, on the
// coloured-target pieces of Base.kt (TargetBox, the slots), reporting what its geometry needs in the state (Lab.kt:
// safeArea, scrollViews, chrome).

@Composable
internal fun EdgesScreen(cell: Cell, lab: Lab) {
    UnbuiltCell(cell)
}
