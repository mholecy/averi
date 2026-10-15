@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalComposeUiApi::class)

package dev.averi.lab

import android.content.Intent
import android.graphics.Rect
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
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
import kotlinx.coroutines.delay
import kotlin.math.roundToInt

// The Android lab app (docs/plans/2026-10-15-ground-truth-lab-app.md, phase 2): the iOS app's cells
// (fixtures/apps/ios/AveriLab) in Compose. One cell per launch — the intent extra `cell` or averilab://cell/<id>; with
// neither, the catalog as a list, for a person poking at the app.

class MainActivity : ComponentActivity() {
    private lateinit var lab: Lab
    private lateinit var catalog: List<Cell>
    private var cell by mutableStateOf<Cell?>(null)
    /** Bumped per `show`: the same cell asked again (a deep link) is built afresh, its layer raised again. */
    private var generation by mutableIntStateOf(0)

    override fun onCreate(savedInstanceState: Bundle?) {
        // Edge to edge: the activity's window is the whole screen, so the cell lays its slots out from the screen's
        // top as the iOS app does (`ignoresSafeArea`).
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        catalog = Catalog.load(this)
        lab = Lab(this, windowManager.maximumWindowMetrics.bounds)
        if (!open(intent)) lab.none()
        setContent {
            MaterialTheme(colorScheme = lightColorScheme()) {
                val c = cell
                when {
                    c == null -> CellList(catalog) { show(it) }
                    !c.supported -> Unsupported(c)
                    else -> key(c.id, generation) { CellScreen(c, lab) }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        open(intent)
    }

    private fun open(intent: Intent?): Boolean {
        val id = intent?.getStringExtra("cell")
            ?: intent?.data?.takeIf { it.scheme == "averilab" && it.host == "cell" }?.pathSegments?.firstOrNull()
            ?: return false
        show(id)
        return true
    }

    private fun show(id: String) {
        val found = catalog.firstOrNull { it.id == id }
        lab.show(id, found)
        cell = found ?: Cell(id, "unknown", emptyList())
        generation++
    }
}

/** A slot's target, as on iOS (Slot in AveriLabApp.swift): 300×64 dp, centred horizontally, its centre 142 + 180·slot dp down. */
private val SLOT_WIDTH = 300.dp
private val SLOT_HEIGHT = 64.dp
private fun slotTop(slot: Int): Dp = (142 + 180 * slot).dp - SLOT_HEIGHT / 2

/**
 * One target: a solid rectangle of its own colour, no visible text, no ripple (a screenshot taken during a probe tap
 * must still show its own colour), its tap logged. Its frame is reported in SCREEN pixels: the bounds in its window
 * plus the window's place on the screen — a sheet's content lives in a window of its own.
 */
@Composable
private fun TargetBox(cell: Cell, t: Target, lab: Lab, modifier: Modifier = Modifier) {
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

@Composable
private fun CellScreen(cell: Cell, lab: Lab) {
    var sheet by remember { mutableStateOf(false) }
    var alert by remember { mutableStateOf(false) }
    // testTagsAsResourceId per composition root: the screen, and the sheet's own window below.
    BoxWithConstraints(Modifier.fillMaxSize().background(Color.White).semantics { testTagsAsResourceId = true }) {
        for (t in cell.targets.filter { !it.onLayer }) {
            TargetBox(cell, t, lab, Modifier.offset(x = (maxWidth - SLOT_WIDTH) / 2, y = slotTop(t.slot)))
        }
    }
    if (sheet) {
        // Partially expanded (the medium detent): content taller than half the screen, so the sheet stops at half,
        // the scrim over the rest; a tap on the scrim dismisses it.
        ModalBottomSheet(
            onDismissRequest = { sheet = false; lab.event("dismissed", "sheet") },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false),
        ) {
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
            text = { Text("A presented layer over the targets.") },
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

@Composable
private fun CellList(catalog: List<Cell>, show: (String) -> Unit) {
    Column(Modifier.fillMaxSize().background(Color.White).safeDrawingPadding().padding(16.dp)) {
        Text("AveriLab", style = MaterialTheme.typography.headlineMedium)
        for (c in catalog) {
            TextButton({ show(c.id) }) { Text(if (c.supported) c.id else "${c.id} (unsupported: ${c.layer})") }
        }
    }
}

/** A cell this app cannot build (a layer only the iOS app has yet, or an id not in the catalog): said, never crashed on. */
@Composable
private fun Unsupported(cell: Cell) {
    Box(Modifier.fillMaxSize().background(Color.White).safeDrawingPadding().padding(16.dp)) {
        Text("Unsupported cell ${cell.id} (layer ${cell.layer})")
    }
}
