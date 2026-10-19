@file:OptIn(ExperimentalComposeUiApi::class)

package dev.averi.lab

// The bars family (fixtures/apps/cells/bars.json): the system bands and the app's chrome over coloured targets — the
// status and navigation bands drawn under edge to edge (`bands`), a pinned bottom button over a target's edge
// (`pinned-bar`), a floating tab bar over a scroll view that runs to the screen's bottom (`tabbar-floating`), a
// transparent full-width host holding a FAB (`fab`). Each cell reports what its geometry is measured from
// (scripts/truth/truth.ts#geometryOf): the system bars' insets (`safeArea`), its scroll view's clip, its chrome's frames.
// `tabbar-hidden-push` (layer `tab-host`) is iOS only: Lab.kt#SUPPORTED_LAYERS leaves it out, and the capture skips it.

import android.graphics.Rect
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
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

@Composable
internal fun BarsScreen(cell: Cell, lab: Lab) {
    when (cell.id) {
        // bands-three-button: the same screen, captured under three-button navigation (CatalogCell.navigation).
        "bands", "bands-three-button" -> Bands(cell, lab)
        "pinned-bar" -> PinnedBar(cell, lab)
        "tabbar-floating" -> TabbarFloating(cell, lab)
        "fab" -> Fab(cell, lab)
        else -> UnbuiltCell(cell)
    }
}

/** The tab bar's and the pinned button's colours: none of them a target's. */
private val CHROME = Color(0xFF263238)
private val CHROME_ITEM = Color(0xFF546E7A)
private val FAB = Color(0xFF00897B)

/** Reports a layout's unclipped frame on the screen (Lab.kt#screenFrame). */
@Composable
private fun reporting(report: (Rect) -> Unit): Modifier {
    val view = LocalView.current
    return Modifier.onGloballyPositioned { c -> report(screenFrame(view, c)) }
}

/**
 * One target of a bars cell: Base.kt's TargetBox (a solid rectangle of its own colour, no ripple, its tap logged) at
 * the size the cell gives it, its frame reported unclipped.
 */
@Composable
private fun BarTarget(cell: Cell, tag: String, lab: Lab, width: Dp, height: Dp, modifier: Modifier = Modifier) {
    val t = cell.targets.firstOrNull { it.tag == tag } ?: return
    Box(
        modifier
            .size(width, height)
            .then(reporting { lab.frame(t.tag, it) })
            .testTag("lab.${cell.id}.${t.tag}")
            .semantics { contentDescription = "Target ${t.tag}" }
            .background(Color(t.color))
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { lab.event("tap", t.tag) },
    )
}

/** The system bars' insets in dp, reported to the state in pixels (Lab.kt#systemBarsInsets, LabState.safeArea). */
private data class Bars(val top: Dp, val bottom: Dp)

@Composable
private fun systemBars(lab: Lab): Bars {
    val r = systemBarsInsets(lab)
    return with(LocalDensity.current) { Bars(r.top.toDp(), r.bottom.toDp()) }
}

/** Ready once the insets have been dispatched and the first layouts reported. */
@Composable
private fun Settle(lab: Lab) {
    LaunchedEffect(Unit) {
        delay(800)
        lab.settled()
    }
}

@Composable
private fun Host(content: @Composable androidx.compose.foundation.layout.BoxWithConstraintsScope.() -> Unit) {
    BoxWithConstraints(Modifier.fillMaxSize().background(Color.White).semantics { testTagsAsResourceId = true }, content = content)
}

private val SLOT_W = 300.dp
private val SLOT_H = 64.dp

/**
 * `bands`: edge to edge, the targets laid against the system bars — S centred in the status band, O its top edge 4 dp
 * into it (centre clear), W in the open, Q its bottom edge 4 dp into the navigation band (centre clear), N centred in
 * the navigation band (calibration.json #21, #22, #23).
 */
@Composable
private fun Bands(cell: Cell, lab: Lab) {
    val bars = systemBars(lab)
    Host {
        val x = (maxWidth - SLOT_W) / 2
        val thin = 16.dp
        BarTarget(cell, "S", lab, SLOT_W, thin, Modifier.offset(x, (bars.top - thin) / 2))
        BarTarget(cell, "O", lab, SLOT_W, SLOT_H, Modifier.offset(x, bars.top - 4.dp))
        BarTarget(cell, "W", lab, SLOT_W, SLOT_H, Modifier.offset(x, (maxHeight - SLOT_H) / 2))
        BarTarget(cell, "Q", lab, SLOT_W, SLOT_H, Modifier.offset(x, maxHeight - bars.bottom + 4.dp - SLOT_H))
        BarTarget(cell, "N", lab, SLOT_W, thin, Modifier.offset(x, maxHeight - bars.bottom + (bars.bottom - thin) / 2))
    }
    Settle(lab)
}

/**
 * `pinned-bar`: a button pinned 16 dp above the navigation band (chrome `pinned`), drawn after — over — P, whose bottom
 * 24 dp it covers (P's centre clear); W in the open (calibration.json #22, the pinned CONTINUE).
 */
@Composable
private fun PinnedBar(cell: Cell, lab: Lab) {
    val bars = systemBars(lab)
    Host {
        val x = (maxWidth - SLOT_W) / 2
        val buttonTop = maxHeight - bars.bottom - 16.dp - 56.dp
        BarTarget(cell, "W", lab, SLOT_W, SLOT_H, Modifier.offset(x, (maxHeight - SLOT_H) / 2 - 120.dp))
        BarTarget(cell, "P", lab, SLOT_W, SLOT_H, Modifier.offset(x, buttonTop + 24.dp - SLOT_H))
        Box(
            Modifier
                .offset(24.dp, buttonTop)
                .size(maxWidth - 48.dp, 56.dp)
                .then(reporting { lab.chrome("pinned", it) })
                .clip(RoundedCornerShape(12.dp))
                .background(CHROME)
                .testTag("lab.${cell.id}.continue")
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { lab.event("button", "pinned.continue") },
            contentAlignment = Alignment.Center,
        ) { Text("Continue", color = Color.White) }
    }
    Settle(lab)
}

/**
 * `tabbar-floating`: a 200-dp header, then a scroll view (`list`) running to the screen's bottom, under a floating tab
 * bar — a pill (chrome `tabBar`) 44 dp above the bottom, its four items 12 dp below its top edge; the pill's surface
 * takes a tap (it logs `button tabBar.surface`), an item logs `tab <name>`. T lies in the open; R's centre in the strip
 * of the pill above its items (calibration.json #14's shape); F far below the fold (#11: a stroke for it must touch down
 * clear of the bar).
 */
@Composable
private fun TabbarFloating(cell: Cell, lab: Lab) {
    systemBars(lab)
    Host {
        val w = maxWidth
        val header = 200.dp
        val pillTop = maxHeight - 44.dp - 87.dp
        val list = rememberScrollState()
        ReportScroll(lab, "list", { list.isScrollInProgress }, { list.value })
        Column(Modifier.fillMaxSize()) {
            Box(Modifier.fillMaxWidth().height(header), contentAlignment = Alignment.Center) { Text("Header") }
            Box(
                Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .then(reporting { lab.scrollView("list", it) })
                    .testTag("lab.${cell.id}.list")
                    .verticalScroll(list),
            ) {
                Box(Modifier.fillMaxWidth().height(2400.dp)) {
                    BarTarget(cell, "T", lab, w - 48.dp, 52.dp, Modifier.offset(24.dp, 100.dp))
                    BarTarget(cell, "R", lab, w - 48.dp, 52.dp, Modifier.offset(24.dp, pillTop + 4.dp - 26.dp - header))
                    BarTarget(cell, "F", lab, w - 48.dp, 52.dp, Modifier.offset(24.dp, 2000.dp))
                }
            }
        }
        Box(
            Modifier
                .offset(24.dp, pillTop)
                .size(maxWidth - 48.dp, 87.dp)
                .then(reporting { lab.chrome("tabBar", it) })
                .testTag("lab.${cell.id}.tabBar")
                .clip(RoundedCornerShape(32.dp))
                .background(CHROME)
                .pointerInput(Unit) { detectTapGestures { lab.event("button", "tabBar.surface") } },
            contentAlignment = Alignment.TopCenter,
        ) {
            Row(Modifier.padding(top = 12.dp)) {
                for (name in listOf("home", "transactions", "cards", "more")) {
                    Box(
                        Modifier
                            .size(82.dp, 64.dp)
                            .testTag("lab.${cell.id}.tab.$name")
                            .semantics { contentDescription = name }
                            .clip(RoundedCornerShape(16.dp))
                            .background(CHROME_ITEM)
                            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { lab.event("tab", name) },
                    )
                }
            }
        }
    }
    Settle(lab)
}

/**
 * `fab`: a scroll view (`list`) under a transparent full-width host (128 dp, 16 dp above the navigation band, listed
 * after the list) holding only a round 96-dp FAB (chrome `fab`): L and K lie in the host's band beside the FAB, W above
 * it (calibration.json #24 — the host is no cover; averi's accepted reading, round 13, is that it is).
 */
@Composable
private fun Fab(cell: Cell, lab: Lab) {
    val bars = systemBars(lab)
    Host {
        val w = maxWidth
        val h = maxHeight
        val hostTop = h - bars.bottom - 16.dp - 128.dp
        val beside = (w - 96.dp) / 2 - 32.dp
        val list = rememberScrollState()
        ReportScroll(lab, "list", { list.isScrollInProgress }, { list.value })
        Box(
            Modifier
                .fillMaxSize()
                .then(reporting { lab.scrollView("list", it) })
                .testTag("lab.${cell.id}.list")
                .verticalScroll(list),
        ) {
            Box(Modifier.fillMaxWidth().height(h + 400.dp)) {
                BarTarget(cell, "W", lab, SLOT_W, SLOT_H, Modifier.offset((w - SLOT_W) / 2, hostTop - 200.dp))
                BarTarget(cell, "L", lab, beside, SLOT_H, Modifier.offset(16.dp, hostTop + 32.dp))
                BarTarget(cell, "K", lab, beside, SLOT_H, Modifier.offset(w - 16.dp - beside, hostTop + 32.dp))
            }
        }
        Box(Modifier.offset(0.dp, hostTop).fillMaxWidth().height(128.dp).testTag("lab.${cell.id}.host"), contentAlignment = Alignment.Center) {
            Box(
                Modifier
                    .size(96.dp)
                    .then(reporting { lab.chrome("fab", it) })
                    .testTag("lab.${cell.id}.fab")
                    .semantics { contentDescription = "Add" }
                    .clip(CircleShape)
                    .background(FAB)
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { lab.event("button", "fab.add") },
            )
        }
    }
    Settle(lab)
}
