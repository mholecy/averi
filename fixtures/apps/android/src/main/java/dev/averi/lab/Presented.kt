@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalComposeUiApi::class)

package dev.averi.lab

// The presented family (fixtures/apps/cells/presented.json): a layer presented over the coloured-target host
// (Base.kt) — a ModalBottomSheet partially expanded with its own target, an AlertDialog; round 7 (ADR 0018's residual
// 19, the windows the uiautomator parser does not mark): a full-screen Compose Dialog and a Views BottomSheetDialog,
// each with its own target. RecordWindowTouches is every Compose dialog's or sheet's touch log (a window of its own),
// for any family; recordTouches a Views dialog's.

import android.view.MotionEvent
import android.view.Window
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
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
import androidx.compose.runtime.rememberCompositionContext
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.compose.ui.platform.LocalSavedStateRegistryOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import com.google.android.material.bottomsheet.BottomSheetDialog
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
        val window = dialogWindow(view)
        val restore = window?.let { recordTouches(it, lab) }
        onDispose { restore?.invoke() }
    }
}

/**
 * The window of the Compose dialog a view is composed in: a Dialog's content view is its DialogLayout, itself the
 * provider; a ModalBottomSheet's or an AlertDialog's content sits one level below it.
 */
private fun dialogWindow(view: android.view.View): Window? =
    ((view as? DialogWindowProvider) ?: (view.parent as? DialogWindowProvider))?.window

/** A window's touch log (TouchLog) installed on it; returns what puts its own callback back. */
internal fun recordTouches(window: Window, lab: Lab): () -> Unit {
    val original = window.callback ?: return {}
    if (original !is TouchLog) window.callback = TouchLog(original, lab)
    return { window.callback = original }
}

private class TouchLog(private val original: Window.Callback, private val lab: Lab) : Window.Callback by original {
    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        if (event.actionMasked == MotionEvent.ACTION_DOWN) lab.touched(event.rawX, event.rawY)
        return original.dispatchTouchEvent(event)
    }
}

/**
 * The cell's layer, raised after the screen beneath has appeared, and the state marked ready once it has settled — a
 * cell with layer `none` (base's `open`) raises nothing and is ready after 300 ms. Composed after the host's Box, as
 * one composable before the split.
 */
@Composable
internal fun PresentedLayer(cell: Cell, lab: Lab) {
    var sheet by remember { mutableStateOf(false) }
    var alert by remember { mutableStateOf(false) }
    var fullScreen by remember { mutableStateOf(false) }
    var viewsSheet by remember { mutableStateOf(false) }
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
    if (fullScreen) FullScreenDialog(cell, lab) { fullScreen = false }
    if (viewsSheet) ViewsBottomSheet(cell, lab) { viewsSheet = false }
    LaunchedEffect(Unit) {
        // The layer is raised after the screen beneath has appeared — as an app raises it — and the state marked ready
        // once its animation has had time to finish.
        delay(300)
        when (cell.layer) {
            "sheet-medium" -> sheet = true
            "alert" -> alert = true
            "dialog-fullscreen" -> fullScreen = true
            "bottom-sheet-dialog" -> viewsSheet = true
        }
        delay(if (cell.layer == "none") 300 else 1500)
        lab.settled()
    }
}

/**
 * A full-screen dialog (`dialog-fullscreen`): a Compose Dialog with `usePlatformDefaultWidth = false` and
 * `decorFitsSystemWindows = false`, its content filling the window — its opaque surface over every target beneath, its
 * own target on it. No outside to touch: back (or Close) dismisses it. Compose lays the window itself, between the
 * system bars at full width (measured `[0,66][1080,2153]` on averi_lab, `(1081x2087) gr=CENTER`): FLAG_LAYOUT_NO_LIMITS,
 * no fitted insets and MATCH_PARENT set on the window after it is shown are overridden by Compose's own size, so a
 * window at 0,0 the screen's size is not what a Compose app gets (docs/bugs/2026-10-19-lab-android-presented-windows-
 * the-parser-does-not-mark-full-screen-dialog-and-bottom-sheet-dialog.md).
 */
@Composable
private fun FullScreenDialog(cell: Cell, lab: Lab, dismissed: () -> Unit) {
    Dialog(
        onDismissRequest = { dismissed(); lab.event("dismissed", "dialog") },
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        RecordWindowTouches(lab)
        Box(Modifier.fillMaxSize().background(Color(0xFFECEFF1)).semantics { testTagsAsResourceId = true }) {
            // Close at the top corner, clear of every slot's centre (a probe there would fire it).
            TextButton({ dismissed(); lab.event("button", "Close") }, Modifier.align(Alignment.TopEnd).padding(16.dp)) { Text("Close") }
            Column(
                Modifier.fillMaxWidth().padding(top = 120.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(24.dp),
            ) {
                Text("Lab full-screen dialog")
                for (t in cell.targets.filter { it.onLayer }) TargetBox(cell, t, lab)
            }
        }
    }
}

/**
 * A Views BottomSheetDialog (`bottom-sheet-dialog`, Material Components' design_bottom_sheet_dialog: the
 * `touch_outside` view over the whole coordinator, a tap on it dismisses the sheet, the sheet after it), its content a
 * ComposeView holding the layer's target — shorter than the sheet's peek height, so the sheet opens whole. The
 * composition is the screen's (its lifecycle and saved-state owners handed to the view), torn down with it.
 */
@Composable
private fun ViewsBottomSheet(cell: Cell, lab: Lab, dismissed: () -> Unit) {
    val context = LocalContext.current
    val parent = rememberCompositionContext()
    val lifecycle = LocalLifecycleOwner.current
    val savedState = LocalSavedStateRegistryOwner.current
    DisposableEffect(Unit) {
        val dialog = BottomSheetDialog(context, com.google.android.material.R.style.Theme_Material3_Light_BottomSheetDialog)
        val content = ComposeView(dialog.context).apply {
            setViewTreeLifecycleOwner(lifecycle)
            setViewTreeSavedStateRegistryOwner(savedState)
            setParentCompositionContext(parent)
            setContent {
                Column(
                    Modifier.fillMaxWidth().height(360.dp).semantics { testTagsAsResourceId = true }.padding(top = 40.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(24.dp),
                ) {
                    Text("Lab bottom sheet dialog")
                    for (t in cell.targets.filter { it.onLayer }) TargetBox(cell, t, lab)
                }
            }
        }
        dialog.setContentView(content)
        dialog.setOnDismissListener { dismissed(); lab.event("dismissed", "sheet") }
        val restore = dialog.window?.let { recordTouches(it, lab) }
        dialog.show()
        onDispose {
            dialog.setOnDismissListener(null)
            restore?.invoke()
            dialog.dismiss()
        }
    }
}
