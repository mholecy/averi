@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalComposeUiApi::class)

package dev.averi.lab

import android.content.Intent
import android.os.Bundle
import android.view.MotionEvent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

// The Android lab app (docs/plans/2026-10-15-ground-truth-lab-app.md, phase 2): the iOS app's cells
// (fixtures/apps/ios/AveriLab) in Compose. One cell per launch — the intent extra `cell` or averilab://cell/<id>; with
// neither, the catalog as a list, for a person poking at the app. One file per cell family (fixtures/apps/cells/<family>.json):
// Base.kt, Presented.kt, Forms.kt, Edges.kt, Bars.kt, FalseCovers.kt; CellRouter below sends a cell to its family's.

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
                    else -> key(c.id, generation) { CellRouter(c, lab) }
                }
            }
        }
    }

    /** Every touch the activity's window receives, before anything handles it (the probe's positive control). */
    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        if (ev.actionMasked == MotionEvent.ACTION_DOWN) lab.touched(ev.rawX, ev.rawY)
        return super.dispatchTouchEvent(ev)
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

/**
 * A cell's screen, by its family (the catalog stamps each cell with it, scripts/truth/catalog.ts). A family adds its
 * cells in its own file; this `when` names every family once, so no batch of phase 3 edits it.
 */
@Composable
private fun CellRouter(cell: Cell, lab: Lab) {
    when (cell.family) {
        "forms" -> FormsScreen(cell, lab)
        "edges" -> EdgesScreen(cell, lab)
        "bars" -> BarsScreen(cell, lab)
        "false-covers" -> FalseCoversScreen(cell, lab)
        // base and presented: the coloured-target host (Base.kt) with the cell's layer (Presented.kt).
        else -> CellScreen(cell, lab)
    }
}

/** A cell of a family whose screen does not build it yet: said on screen, never `ready`. */
@Composable
internal fun UnbuiltCell(cell: Cell) {
    Box(Modifier.fillMaxSize().background(Color.White).safeDrawingPadding().padding(16.dp)) {
        Text("Cell ${cell.id}: no view of family ${cell.family} builds it yet")
    }
}
