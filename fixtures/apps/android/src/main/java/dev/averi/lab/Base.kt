@file:OptIn(ExperimentalComposeUiApi::class)

package dev.averi.lab

// The base family (fixtures/apps/cells/base.json): the coloured-target host every coloured-target cell is drawn on —
// four slots down the screen, each target a solid rectangle of its own colour reporting its frame in screen pixels. The
// `open` cell is this host alone; a presented cell raises its layer over it (Presented.kt#PresentedLayer, which also
// marks the state ready).

import android.graphics.Rect
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

/**
 * A slot's target, as on iOS (Slot in Base.swift): 300×64 dp, centred horizontally, its centre 142 + 180·slot dp down.
 */
private val SLOT_WIDTH = 300.dp
private val SLOT_HEIGHT = 64.dp
private fun slotTop(slot: Int): Dp = (142 + 180 * slot).dp - SLOT_HEIGHT / 2

/**
 * One target: a solid rectangle of its own colour, no visible text, no ripple (a screenshot taken during a probe tap
 * must still show its own colour), its tap logged. Its frame is reported in SCREEN pixels: the bounds in its window
 * plus the window's place on the screen — a sheet's content lives in a window of its own.
 */
@Composable
internal fun TargetBox(cell: Cell, t: Target, lab: Lab, modifier: Modifier = Modifier) {
    val view = LocalView.current
    Box(
        modifier
            .size(SLOT_WIDTH, SLOT_HEIGHT)
            .testTag("lab.${cell.id}.${t.tag}")
            .semantics { contentDescription = "Target ${t.tag}" }
            .background(Color(t.color))
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { lab.event("tap", t.tag) }
            .onGloballyPositioned { c ->
                val at = IntArray(2).also(view::getLocationOnScreen)
                val b = c.boundsInWindow()
                lab.frame(t.tag, Rect(at[0] + b.left.roundToInt(), at[1] + b.top.roundToInt(), at[0] + b.right.roundToInt(), at[1] + b.bottom.roundToInt()))
            },
    )
}

/**
 * The targets beneath the layer, each at its slot; the cell's layer (none for `open`) raised by PresentedLayer
 * (Presented.kt).
 */
@Composable
internal fun CellScreen(cell: Cell, lab: Lab) {
    // testTagsAsResourceId per composition root: the screen, and the sheet's own window below.
    BoxWithConstraints(Modifier.fillMaxSize().background(Color.White).semantics { testTagsAsResourceId = true }) {
        for (t in cell.targets.filter { !it.onLayer }) {
            TargetBox(cell, t, lab, Modifier.offset(x = (maxWidth - SLOT_WIDTH) / 2, y = slotTop(t.slot)))
        }
    }
    PresentedLayer(cell, lab)
}
