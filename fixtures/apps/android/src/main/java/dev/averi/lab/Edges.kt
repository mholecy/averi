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
    // scroll-bounded-flush: scroll-bounded's layout, its targets SplitBoxes (W, P, S; no O, F) — their uiautomator
    // bounds cut flush with the container's edge (calibration.json #12, #13).
    "scroll-bounded", "scroll-bounded-flush" -> listOf(
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

/**
 * The cells whose targets are SplitBoxes: a target's identified node not clickable, so uiautomator's bounds of it are cut
 * where its container clips it (measured: a clickable node's run on 66 px — 24 dp, half the 48-dp minimum touch target
 * — past a clipping container, scroll-bounded's S `[128,1519][953,1607]` under a clip ending at 1541, so P, 66 px past
 * its clip, reads whole). mp-native's SWIFT form rows (a testTag container around their clickable content) read cut
 * flush: docs/bugs/2026-10-09-android-scroll-until-fully-trusts-bounds-clipped-to-scroll-container.md,
 * …-tap-on-a-sliver-at-scroll-container-edge-reports-tapped-and-does-nothing.md.
 */
private val SPLIT_CELLS = setOf("scroll-bounded-flush", "scroll-sticky-cut")

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

/**
 * One target as an app's row with an identified container (mp-native's `testTag` rows): the container (the target's
 * id, its unclipped frame reported) neither clickable nor merging, holding its content — a clickable box of the
 * target's colour labelled `Target <tag>` filling it, whose tap is logged. The container's node is what a selector by
 * id finds; its bounds are what the clip (or a node drawn over it) leaves of it.
 */
@Composable
private fun SplitBox(cell: Cell, t: Target, lab: Lab, modifier: Modifier = Modifier) {
    val view = LocalView.current
    Box(
        modifier
            .size(ROW_WIDTH, ROW_HEIGHT)
            .testTag("lab.${cell.id}.${t.tag}")
            .onGloballyPositioned { lab.frame(t.tag, screenFrame(view, it)) },
    ) {
        Box(
            Modifier
                .fillMaxSize()
                .semantics { contentDescription = "Target ${t.tag}" }
                .background(Color(t.color))
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { lab.event("tap", t.tag) },
        )
    }
}

/** The cell's target box: a SplitBox in SPLIT_CELLS, else an EdgeBox. */
@Composable
private fun RowBox(cell: Cell, t: Target, lab: Lab, modifier: Modifier = Modifier) {
    if (cell.id in SPLIT_CELLS) SplitBox(cell, t, lab, modifier) else EdgeBox(cell, t, lab, modifier)
}

@Composable
internal fun EdgesScreen(cell: Cell, lab: Lab) {
    systemBarsInsets(lab)
    BoxWithConstraints(Modifier.fillMaxSize().background(Color.White).semantics { testTagsAsResourceId = true }) {
        if (cell.id == "scroll-sticky" || cell.id == "scroll-sticky-cut") {
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
                RowBox(cell, t, lab, Modifier.align(Alignment.TopCenter).offset(y = y))
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
                    // scroll-sticky-cut: the header one accessibility element (as a header with a title and an action
                    // is), so Compose takes what it covers out of the rows' bounds beneath it — mp-native's Account
                    // Detail, a row's container cut at its sticky date header (calibration.json #9).
                    .then(if (cell.id == "scroll-sticky-cut") Modifier.semantics(mergeDescendants = true) {} else Modifier)
                    .onGloballyPositioned { lab.chrome("stickyHeader", screenFrame(view, it)) },
                contentAlignment = Alignment.Center,
            ) { Text("Sticky header", color = Color.White) }
        }
        for (t in cell.targets) item { RowBox(cell, t, lab) }
        items(15) { Box(Modifier.fillMaxWidth().height(ROW_HEIGHT)) }
    }
}
