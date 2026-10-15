@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalComposeUiApi::class)

package dev.averi.lab

// The presented family (fixtures/apps/cells/presented.json): a layer presented over the coloured-target host
// (Base.kt) — a ModalBottomSheet partially expanded with its own target, an AlertDialog. Phase 3's presented cells are
// added here. RecordWindowTouches is every dialog's or sheet's touch log (a window of its own), for any family.

import android.view.MotionEvent
import android.view.Window
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogWindowProvider
import kotlinx.coroutines.delay

/**
 * Every touch the window of the dialog this is composed in receives — a dialog and a modal sheet are windows of their
 * own, which the activity's dispatchTouchEvent never sees: its Window.Callback is wrapped to log each touch's start
 * (the dim outside an alert's card included: a modal window receives every touch) and pass the event on unchanged.
 */
@Composable
internal fun RecordWindowTouches(lab: Lab) {
    val view = LocalView.current
    DisposableEffect(view) {
        val window = (view.parent as? DialogWindowProvider)?.window
        val original = window?.callback
        if (window != null && original != null && original !is TouchLog) window.callback = TouchLog(original, lab)
        onDispose { if (window != null && original != null) window.callback = original }
    }
}

private class TouchLog(private val original: Window.Callback, private val lab: Lab) : Window.Callback by original {
    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        if (event.actionMasked == MotionEvent.ACTION_DOWN) lab.touched(event.rawX, event.rawY)
        return original.dispatchTouchEvent(event)
    }
}

/**
 * The cell's layer, raised after the screen beneath has appeared, and the state marked ready once it has settled — a cell
 * with layer `none` (base's `open`) raises nothing and is ready after 300 ms. Composed after the host's Box, as one
 * composable before the split.
 */
@Composable
internal fun PresentedLayer(cell: Cell, lab: Lab) {
    var sheet by remember { mutableStateOf(false) }
    var alert by remember { mutableStateOf(false) }
    if (sheet) {
        // Partially expanded (the medium detent): content taller than half the screen, so the sheet stops at half,
        // the scrim over the rest; a tap on the scrim dismisses it.
        ModalBottomSheet(
            onDismissRequest = { sheet = false; lab.event("dismissed", "sheet") },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false),
        ) {
            RecordWindowTouches(lab)
            Column(
                Modifier.fillMaxWidth().fillMaxHeight().semantics { testTagsAsResourceId = true }.padding(top = 40.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(24.dp),
            ) {
                for (t in cell.targets.filter { it.onLayer }) TargetBox(cell, t, lab)
            }
        }
    }
    if (alert) {
        AlertDialog(
            onDismissRequest = { alert = false; lab.event("dismissed", "alert") },
            confirmButton = { TextButton({ alert = false; lab.event("button", "Keep") }) { Text("Keep") } },
            dismissButton = { TextButton({ alert = false; lab.event("button", "Discard") }) { Text("Discard") } },
            title = { Text("Lab alert") },
            text = {
                RecordWindowTouches(lab)
                Text("A presented layer over the targets.")
            },
        )
    }
    LaunchedEffect(Unit) {
        // The layer is raised after the screen beneath has appeared — as an app raises it — and the state marked ready
        // once its animation has had time to finish.
        delay(300)
        when (cell.layer) {
            "sheet-medium" -> sheet = true
            "alert" -> alert = true
        }
        delay(if (cell.layer == "none") 300 else 1500)
        lab.settled()
    }
}
