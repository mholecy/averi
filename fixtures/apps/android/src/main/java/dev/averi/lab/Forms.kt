package dev.averi.lab

import androidx.compose.runtime.Composable

// The forms family (fixtures/apps/cells/forms.json) on Android: phase 2b builds the form cells here. Until then a form
// cell shows the coloured-target host with no targets, as before the per-family split (the capture skips form cells on
// Android: scripts/truth/lab-device.ts#AndroidLab.unsupported).

@Composable
internal fun FormsScreen(cell: Cell, lab: Lab) {
    CellScreen(cell, lab)
}
