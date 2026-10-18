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
import android.view.ContextThemeWrapper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.LinearLayout
import androidx.core.widget.NestedScrollView
import androidx.coordinatorlayout.widget.CoordinatorLayout
import com.google.android.material.appbar.AppBarLayout
import com.google.android.material.appbar.CollapsingToolbarLayout
import com.google.android.material.appbar.MaterialToolbar

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
        } else if (cell.id == "scroll-collapsing") {
            CollapsingList(cell, lab)
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

/**
 * scroll-collapsing (Android only, calibration.json #10): Settings' homepage shape in Views — a CoordinatorLayout
 * holding an AppBarLayout (a CollapsingToolbarLayout, 200 dp expanded, its toolbar pinned) and a NestedScrollView laid
 * below it by AppBarLayout.ScrollingViewBehavior (the clip `list`), its rows a column of 300×64 dp Views 80 dp apart
 * (the first at 16 dp). On appear the app bar is collapsed and the list scrolled ROW_SCROLL (260 dp): A (row 2,
 * content 176–240) lies wholly above the list's top, under the collapsed app bar, its centre below the status band
 * (outside-scroll-view) — the row Settings dumps with inverted bounds, its top clamped to the list's and its bottom
 * where it lies (docs/bugs/2026-10-09-android-inverted-uiautomator-bounds-pass-through-as-negative-heights.md:
 * View#getBoundsOnScreen clamps each side to each parent apart); D (row 3, 256–320) is cut 4 dp by the list's top,
 * its centre showing (partly-centre-in). A row's id is
 * its accessibility node's viewIdResourceName (a View has no resource of that name), its frame its unclipped place on
 * the screen.
 */
private object CollapsingLayout {
    const val EXPANDED = 200
    const val ROW_PITCH = 80
    const val ROW_TOP = 16
    const val ROWS = 20
    const val ROW_SCROLL = 260
    val TARGET_ROWS = mapOf(2 to "A", 3 to "D")
}

@Composable
private fun CollapsingList(cell: Cell, lab: Lab) {
    AndroidView(factory = { context -> collapsingList(ContextThemeWrapper(context, com.google.android.material.R.style.Theme_Material3_Light_NoActionBar), cell, lab) }, modifier = Modifier.fillMaxSize())
}

private fun collapsingList(context: android.content.Context, cell: Cell, lab: Lab): View {
    val l = CollapsingLayout
    val px = { dp: Int -> (dp * context.resources.displayMetrics.density).toInt() }
    val root = CoordinatorLayout(context).apply { setBackgroundColor(android.graphics.Color.WHITE); clipChildren = false }
    // The app bar below the status bar (an AndroidView hears of no window insets: its height read from the resources),
    // opaque and raised, so it is drawn over what of the list runs on above the list's top.
    val status = context.resources.getIdentifier("status_bar_height", "dimen", "android").let { if (it == 0) 0 else context.resources.getDimensionPixelSize(it) }
    val appBar = AppBarLayout(context).apply { setPadding(0, status, 0, 0); setBackgroundColor(0xFF455A64.toInt()); elevation = px(4).toFloat() }
    val collapsing = CollapsingToolbarLayout(context).apply { title = "Collapsing" }
    val toolbar = MaterialToolbar(context)
    collapsing.addView(toolbar, CollapsingToolbarLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, px(56)).apply { collapseMode = CollapsingToolbarLayout.LayoutParams.COLLAPSE_MODE_PIN })
    appBar.addView(collapsing, AppBarLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, px(l.EXPANDED)).apply { scrollFlags = AppBarLayout.LayoutParams.SCROLL_FLAG_SCROLL or AppBarLayout.LayoutParams.SCROLL_FLAG_EXIT_UNTIL_COLLAPSED })
    // Neither the list nor its parent clips what runs on past the list's edges (clipChildren, clipToPadding false:
    // ViewGroup#getChildVisibleRect clips a group to its bounds only when ITS parent clips children): a row scrolled
    // above the list's top stays visible to the accessibility framework, and is dumped, while View#getBoundsOnScreen
    // clamps its top to the list's and leaves its bottom where it lies — the inverted bounds.
    val list = NestedScrollView(context).apply { setBackgroundColor(0xFFEEEEEE.toInt()); clipChildren = false; clipToPadding = false }
    val column = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; setPadding(0, px(l.ROW_TOP), 0, px(l.ROW_TOP)); clipChildren = false; clipToPadding = false }
    val rows = mutableMapOf<String, View>()
    for (i in 0 until l.ROWS) {
        val t = l.TARGET_ROWS[i]?.let { tag -> cell.targets.firstOrNull { it.tag == tag } }
        val row = View(context)
        if (t != null) {
            row.setBackgroundColor(t.color.toInt())
            row.contentDescription = "Target ${t.tag}"
            row.setOnClickListener { lab.event("tap", t.tag) }
            val id = "lab.${cell.id}.${t.tag}"
            row.accessibilityDelegate = object : View.AccessibilityDelegate() {
                override fun onInitializeAccessibilityNodeInfo(host: View, info: AccessibilityNodeInfo) {
                    super.onInitializeAccessibilityNodeInfo(host, info)
                    info.viewIdResourceName = id
                }
            }
            rows[t.tag] = row
        } else {
            row.setBackgroundColor(0xFFB0BEC5.toInt())
        }
        column.addView(row, LinearLayout.LayoutParams(px(300), px(64)).apply { bottomMargin = px(l.ROW_PITCH - 64) })
    }
    list.addView(column)
    root.addView(list, CoordinatorLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT).apply { behavior = AppBarLayout.ScrollingViewBehavior() })
    root.addView(appBar, CoordinatorLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
    val onScreen = { v: View -> IntArray(2).also(v::getLocationOnScreen).let { android.graphics.Rect(it[0], it[1], it[0] + v.width, it[1] + v.height) } }
    val report = {
        lab.scrollView("list", onScreen(list))
        for ((tag, v) in rows) lab.frame(tag, onScreen(v))
    }
    // Per view, not the window's ViewTreeObserver (which outlives this cell's views in the process).
    list.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> report() }
    // The offset and its strokes (Lab.scroll): a View reports no scroll phase, so a stroke ends 200 ms after the last
    // change.
    val rest = Runnable { lab.scroll("list", false, list.scrollY); report() }
    list.setOnScrollChangeListener { _: View, _: Int, y: Int, _: Int, _: Int ->
        lab.scroll("list", true, y)
        list.removeCallbacks(rest)
        list.postDelayed(rest, 200)
        report()
    }
    appBar.addOnOffsetChangedListener { _, _ -> report() }
    root.post {
        appBar.setExpanded(false, false)
        list.post {
            list.scrollTo(0, px(l.ROW_SCROLL))
            list.post { lab.scroll("list", false, list.scrollY); report() }
        }
    }
    return root
}
