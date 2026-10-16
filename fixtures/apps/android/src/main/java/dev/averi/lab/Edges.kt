@file:OptIn(ExperimentalComposeUiApi::class, ExperimentalFoundationApi::class)

package dev.averi.lab

// The edges family (fixtures/apps/cells/edges.json): targets at an edge of their scroll container (cut, a sliver,
// outside its clip, overlapped by a sticky header) or of the screen (off it, resting in the status band) — Edges.swift's
// layout tables, the same numbers in dp. Each target is a 300×64 dp box at a fixed place in a scroll container's
// content, the container at a fixed place on the screen and scrolled to a fixed offset from its first frame. A target
// reports its UNCLIPPED frame (Lab.kt#screenFrame — Base.kt's boundsInWindow is clipped by the container, and the truth
// must see where the frame runs on past the clip); the state reports what its geometry is
// measured against (scripts/truth/truth.ts#geometryOf): the system bars' insets, each container's clip, the sticky
// header as chrome.

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

/** A scroll container of an edges cell (Edges.swift#EdgeScroller): `height` null runs to the screen's bottom. */
private class EdgeScroller(val id: String, val top: Dp, val height: Dp?, val content: Dp, val offset: Dp, val rows: List<Pair<String, Dp>>)

/** Edges.swift#EdgeLayout.scrollers, in dp (the Pixel 3a: 392×807 dp, 1080×2220 px). */
private fun scrollersOf(cell: String): List<EdgeScroller> = when (cell) {
    "scroll-bounded" -> listOf(
        EdgeScroller("upper", 110.dp, 220.dp, 700.dp, 0.dp, listOf("W" to 10.dp, "P" to 180.dp)),
        EdgeScroller("lower", 380.dp, 180.dp, 1300.dp, 0.dp, listOf("S" to 172.dp, "O" to 240.dp, "F" to 1000.dp)),
    )
    // Scrolled 400 dp, not iOS's 382: T (-20–44 dp) rests with its centre 12 dp inside the 24-dp status bar.
    "scroll-top-edge" -> listOf(EdgeScroller("page", 0.dp, null, 2400.dp, 400.dp, listOf("A" to 100.dp, "T" to 380.dp)))
    else -> emptyList()
}

/** Edges.swift#EdgeLayout.sticky. */
private val STICKY_TOP = 110.dp
private val STICKY_HEIGHT = 450.dp
private val STICKY_HEADER = 56.dp
private val STICKY_OFFSET = 24.dp

private val ROW_WIDTH = 300.dp
private val ROW_HEIGHT = 64.dp

/** One target, as Base.kt's TargetBox draws it, reporting its unclipped frame. */
@Composable
private fun EdgeBox(cell: Cell, t: Target, lab: Lab, modifier: Modifier = Modifier) {
    val view = LocalView.current
    Box(
        modifier
            .size(ROW_WIDTH, ROW_HEIGHT)
            .testTag("lab.${cell.id}.${t.tag}")
            .semantics { contentDescription = "Target ${t.tag}" }
            .background(Color(t.color))
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { lab.event("tap", t.tag) }
            .onGloballyPositioned { lab.frame(t.tag, screenFrame(view, it)) },
    )
}

@Composable
internal fun EdgesScreen(cell: Cell, lab: Lab) {
    systemBarsInsets(lab)
    BoxWithConstraints(Modifier.fillMaxSize().background(Color.White).semantics { testTagsAsResourceId = true }) {
        if (cell.id == "scroll-sticky") {
            StickyList(cell, lab)
        } else {
            // Laid out down a column (not offset): each container's clip is where the layout puts it.
            val screenHeight = maxHeight
            Column(Modifier.fillMaxWidth()) {
                var bottom = 0.dp
                for (s in scrollersOf(cell.id)) {
                    Spacer(Modifier.height(s.top - bottom))
                    val height = s.height ?: (screenHeight - s.top)
                    EdgeScrollColumn(cell, s, lab, height)
                    bottom = s.top + height
                }
            }
        }
    }
    LaunchedEffect(cell.id) {
        // The insets reported (systemBarsInsets), the offsets applied and the frames reported before the capture reads
        // the state.
        delay(1000)
        lab.settled()
    }
}

@Composable
private fun EdgeScrollColumn(cell: Cell, s: EdgeScroller, lab: Lab, height: Dp) {
    val view = LocalView.current
    val initial = with(LocalDensity.current) { s.offset.roundToPx() }
    Box(
        Modifier
            .fillMaxWidth()
            .height(height)
            .background(Color(0xFFEEEEEE))
            .onGloballyPositioned { lab.scrollView(s.id, screenFrame(view, it)) }
            .verticalScroll(rememberScrollState(initial)),
    ) {
        Box(Modifier.fillMaxWidth().height(s.content)) {
            for ((tag, y) in s.rows) {
                val t = cell.targets.firstOrNull { it.tag == tag } ?: continue
                EdgeBox(cell, t, lab, Modifier.align(Alignment.TopCenter).offset(y = y))
            }
        }
    }
}

@Composable
private fun StickyList(cell: Cell, lab: Lab) {
    val view = LocalView.current
    val initial = with(LocalDensity.current) { STICKY_OFFSET.roundToPx() }
    LazyColumn(
        Modifier
            .padding(top = STICKY_TOP)
            .fillMaxWidth()
            .height(STICKY_HEIGHT)
            .background(Color(0xFFEEEEEE))
            .onGloballyPositioned { lab.scrollView("list", screenFrame(view, it)) },
        state = rememberLazyListState(0, initial),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        stickyHeader {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(STICKY_HEADER)
                    .background(Color(0xFF455A64))
                    .testTag("lab.${cell.id}.header")
                    .onGloballyPositioned { lab.chrome("stickyHeader", screenFrame(view, it)) },
                contentAlignment = Alignment.Center,
            ) { Text("Sticky header", color = Color.White) }
        }
        for (t in cell.targets) item { EdgeBox(cell, t, lab) }
        items(15) { Box(Modifier.fillMaxWidth().height(ROW_HEIGHT)) }
    }
}
