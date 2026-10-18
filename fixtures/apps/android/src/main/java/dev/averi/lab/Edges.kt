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
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.delay

/**
 * A scroll container of an edges cell (Edges.swift#EdgeScroller): `height` null runs to the screen's bottom; `content`
 * null is its height plus the offset — scrolled to its end.
 */
private class EdgeScroller(val id: String, val top: Dp, val height: Dp?, val content: Dp?, val offset: Dp, val rows: List<Pair<String, Dp>>)

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
    // scroll-top-edge's page, its content ending at the screen's bottom: nothing more to scroll toward the content's end
    // (calibration.json #17's turn-back, live).
    "scroll-top-edge-end" -> listOf(EdgeScroller("page", 0.dp, null, null, 400.dp, listOf("A" to 100.dp, "T" to 380.dp)))
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

/**
 * scroll-sticky-view (round 4, calibration.json #9): a SplitBox whose content is an Android View (AndroidView), not a
 * Compose node — the container (the target's id, a Compose node) neither clickable nor merging, its content a
 * clickable android.view.View of the target's colour labelled `Target <tag>`. Compose's accessibility takes what the
 * merged sticky header covers out of the container's bounds, as on scroll-sticky-cut; the View's bounds are the View
 * system's (View#getBoundsOnScreen, clipped by its parent views only, not by the LazyColumn's clip or the header), so
 * they stay whole — the shape of mp-native's Account Detail (`row_0 66,480 948x84`, its children `66,403 948x143`).
 */
@Composable
private fun ViewSplitBox(cell: Cell, t: Target, lab: Lab, modifier: Modifier = Modifier) {
    val view = LocalView.current
    Box(
        modifier
            .size(ROW_WIDTH, ROW_HEIGHT)
            .testTag("lab.${cell.id}.${t.tag}")
            .onGloballyPositioned { lab.frame(t.tag, screenFrame(view, it)) },
    ) {
        AndroidView(
            factory = { context ->
                android.view.View(context).apply {
                    setBackgroundColor(t.color.toInt())
                    contentDescription = "Target ${t.tag}"
                    setOnClickListener { lab.event("tap", t.tag) }
                }
            },
            modifier = Modifier.fillMaxSize(),
        )
    }
}

/** The cell's target box: a ViewSplitBox on scroll-sticky-view, a SplitBox in SPLIT_CELLS, else an EdgeBox. */
@Composable
private fun RowBox(cell: Cell, t: Target, lab: Lab, modifier: Modifier = Modifier) {
    when {
        cell.id == "scroll-sticky-view" -> ViewSplitBox(cell, t, lab, modifier)
        cell.id in SPLIT_CELLS -> SplitBox(cell, t, lab, modifier)
        else -> EdgeBox(cell, t, lab, modifier)
    }
}

@Composable
internal fun EdgesScreen(cell: Cell, lab: Lab) {
    systemBarsInsets(lab)
    BoxWithConstraints(Modifier.fillMaxSize().background(Color.White).semantics { testTagsAsResourceId = true }) {
        if (cell.id == "scroll-sticky" || cell.id == "scroll-sticky-cut" || cell.id == "scroll-sticky-view") {
            StickyList(cell, lab)
        } else if (cell.id == "carousel-in-list") {
            CarouselInList(cell, lab, maxWidth, maxHeight)
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
    val state = rememberScrollState(initial)
    ReportScroll(lab, s.id, { state.isScrollInProgress }, { state.value })
    Box(
        Modifier
            .fillMaxWidth()
            .height(height)
            .background(Color(0xFFEEEEEE))
            .onGloballyPositioned { lab.scrollView(s.id, screenFrame(view, it)) }
            .verticalScroll(state),
    ) {
        Box(Modifier.fillMaxWidth().height(s.content ?: (height + s.offset))) {
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
    val density = LocalDensity.current
    val initial = with(density) { STICKY_OFFSET.roundToPx() }
    val state = rememberLazyListState(0, initial)
    // The list's offset in pixels down its content: the header item (index 0) then rows of ROW_HEIGHT.
    val header = with(density) { STICKY_HEADER.roundToPx() }
    val row = with(density) { ROW_HEIGHT.roundToPx() }
    ReportScroll(lab, "list", { state.isScrollInProgress }) {
        val i = state.firstVisibleItemIndex
        (if (i == 0) 0 else header + (i - 1) * row) + state.firstVisibleItemScrollOffset
    }
    LazyColumn(
        Modifier
            .padding(top = STICKY_TOP)
            .fillMaxWidth()
            .height(STICKY_HEIGHT)
            .background(Color(0xFFEEEEEE))
            .onGloballyPositioned { lab.scrollView("list", screenFrame(view, it)) },
        state = state,
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
                    .then(if (cell.id == "scroll-sticky-cut" || cell.id == "scroll-sticky-view") Modifier.semantics(mergeDescendants = true) {} else Modifier)
                    .onGloballyPositioned { lab.chrome("stickyHeader", screenFrame(view, it)) },
                contentAlignment = Alignment.Center,
            ) { Text("Sticky header", color = Color.White) }
        }
        for (t in cell.targets) item { RowBox(cell, t, lab) }
        items(15) { Box(Modifier.fillMaxWidth().height(ROW_HEIGHT)) }
    }
}

/**
 * Edges.swift#CarouselLayout in dp: carousel-in-list — a page (the whole screen, scrolled 300 dp on appear) holding a
 * horizontal card carousel (24 dp in, 344×85 dp, on the screen at 138 dp) above a list of rows (300×64 dp, from
 * content 560, 80 dp apart): U above the screen (content 100: off-screen, `up`), B the list's 11th row (content 1360,
 * below the screen: off-screen, `down`), and in the carousel C, the card right
 * of the first (its content x 344: on the screen at 368–392 dp, right of the carousel's clip — outside-scroll-view, its
 * scroll toward it `right`). The banking screen of docs/bugs/2026-10-16-lab-ios-wda-scroll-until-strokes-beside-the-
 * targets-scroll-view.md (its residual: the carousel `24,138 354x85` near the top, a long list below).
 */
private object CarouselLayout {
    val CONTENT = 2400.dp
    val OFFSET = 300.dp
    val U = 100.dp
    val B = 1360.dp
    /** The list's rows below the carousel: the first's top, their pitch, how many (B is one of them). */
    val ROWS_TOP = 560.dp
    val ROW_PITCH = 80.dp
    const val ROWS = 22
    val CAROUSEL_TOP = 438.dp
    val CAROUSEL_X = 24.dp
    val CARD_HEIGHT = 85.dp
    /** The cards in carousel order: a filler, C, a filler. */
    const val CARDS = 3
}

@Composable
private fun CarouselInList(cell: Cell, lab: Lab, screenWidth: Dp, screenHeight: Dp) {
    val view = LocalView.current
    val density = LocalDensity.current
    val l = CarouselLayout
    val page = rememberScrollState(with(density) { l.OFFSET.roundToPx() })
    val carousel = rememberScrollState(0)
    val cardWidth = screenWidth - l.CAROUSEL_X * 2
    ReportScroll(lab, "page", { page.isScrollInProgress }, { page.value })
    ReportScroll(lab, "carousel", { carousel.isScrollInProgress }, { carousel.value })
    Box(
        Modifier
            .fillMaxWidth()
            .height(screenHeight)
            .background(Color(0xFFEEEEEE))
            .onGloballyPositioned { lab.scrollView("page", screenFrame(view, it)) }
            .verticalScroll(page),
    ) {
        Box(Modifier.fillMaxWidth().height(l.CONTENT)) {
            for (i in 0 until l.ROWS) {
                val y = l.ROWS_TOP + l.ROW_PITCH * i
                if (y == l.B) continue
                Box(Modifier.align(Alignment.TopCenter).offset(y = y).size(ROW_WIDTH, ROW_HEIGHT).background(Color(0xFFB0BEC5)))
            }
            for ((tag, y) in listOf("U" to l.U, "B" to l.B)) {
                val t = cell.targets.firstOrNull { it.tag == tag } ?: continue
                EdgeBox(cell, t, lab, Modifier.align(Alignment.TopCenter).offset(y = y))
            }
            Box(
                Modifier
                    .offset(x = l.CAROUSEL_X, y = l.CAROUSEL_TOP)
                    .size(cardWidth, l.CARD_HEIGHT)
                    .onGloballyPositioned { lab.scrollView("carousel", screenFrame(view, it)) }
                    .horizontalScroll(carousel),
            ) {
                Row {
                    val c = cell.targets.firstOrNull { it.tag == "C" }
                    for (i in 0 until l.CARDS) {
                        if (i == 1 && c != null) {
                            CardBox(cell, c, lab, Modifier.size(cardWidth, l.CARD_HEIGHT))
                        } else {
                            Box(Modifier.size(cardWidth, l.CARD_HEIGHT).background(Color(0xFF90A4AE)))
                        }
                    }
                }
            }
        }
    }
}

/** A carousel card: EdgeBox at the card's size. */
@Composable
private fun CardBox(cell: Cell, t: Target, lab: Lab, modifier: Modifier) {
    val view = LocalView.current
    Box(
        modifier
            .testTag("lab.${cell.id}.${t.tag}")
            .semantics { contentDescription = "Target ${t.tag}" }
            .background(Color(t.color))
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { lab.event("tap", t.tag) }
            .onGloballyPositioned { lab.frame(t.tag, screenFrame(view, it)) },
    )
}
