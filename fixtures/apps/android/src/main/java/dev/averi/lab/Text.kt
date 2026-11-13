@file:OptIn(ExperimentalComposeUiApi::class)

package dev.averi.lab

// The text family (fixtures/apps/cells/text.json, phase 4): text targets carrying P5's sample strings — each a box of
// its colour with the string drawn on it in black, the box the target: one clickable node whose text is the string,
// identified lab.<cell>.<tag>, its frame reported as `<tag>` and `<tag>.box` (the one `drawn` is measured over:
// scripts/truth/capture-run.ts). A tap on it logs the target's `tap`.
//
// - `text-sample`: ten open strings down the screen, 380×64 dp, the string 16 sp.
// - `text-under-bar`: S centred in the status band (the whole width, 16 dp), W in the open, P under a button pinned
//   16 dp above the navigation band (chrome `pinned`, Bars.kt's PinnedBar) — P's top 8 dp above the button, its centre
//   and its string under it (calibration.json #22's OCR half).
// - `text-nav-cut` (gesture navigation): T's node laid 49 px tall, its foot flush with the navigation band's top, its
//   text box 74 px from the node's top drawn on past it, unclipped, into the band — Settings' row shape in
//   docs/bugs/2026-10-12-android-pixel-asserts-read-a-text-cut-at-the-navigation-bar.md (`198,2105 428x49` of a
//   74-px row). What Compose dumps is NOT that shape: the node by its 48-dp minimum touch target, [108,2064][972,2196]
//   (running on into the band), and its string as a node of its own by its full bounds, [366,2109][714,2175] — neither
//   cut at the band (measured 2026-10-16), so the cut-glyph OCR half of the note is not reproduced (calibration.json
//   #23's needs). The frame reported (`T`, `T.box`) is the text box's, all of it: 108,2105 864x74.

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

@Composable
internal fun TextScreen(cell: Cell, lab: Lab) {
    val bars = systemBarsInsets(lab)
    BoxWithConstraints(Modifier.fillMaxSize().background(Color.White).semantics { testTagsAsResourceId = true }) {
        val w = maxWidth
        when (cell.id) {
            "text-sample" -> for (t in cell.targets) {
                TextTarget(cell, t, lab, 380.dp, 64.dp, 16, Modifier.offset((w - 380.dp) / 2, (96 + 72 * t.slot).dp - 32.dp))
            }
            "text-under-bar" -> {
                val top = with(LocalDensity.current) { bars.top.toDp() }
                val bottom = with(LocalDensity.current) { bars.bottom.toDp() }
                val buttonTop = maxHeight - bottom - 16.dp - 56.dp
                val box = 300.dp to 64.dp
                cell.targets.firstOrNull { it.tag == "S" }?.let { TextTarget(cell, it, lab, w, 16.dp, 11, Modifier.offset(0.dp, (top - 16.dp) / 2)) }
                cell.targets.firstOrNull { it.tag == "W" }?.let { TextTarget(cell, it, lab, box.first, box.second, 16, Modifier.offset((w - box.first) / 2, (maxHeight - box.second) / 2 - 120.dp)) }
                cell.targets.firstOrNull { it.tag == "P" }?.let { TextTarget(cell, it, lab, box.first, box.second, 16, Modifier.offset((w - box.first) / 2, buttonTop - 8.dp)) }
                val view = LocalView.current
                Box(
                    Modifier
                        .offset(24.dp, buttonTop)
                        .size(w - 48.dp, 56.dp)
                        .onGloballyPositioned { lab.chrome("pinned", screenFrame(view, it)) }
                        .clip(RoundedCornerShape(12.dp))
                        .background(Color(0xFF263238))
                        .testTag("lab.${cell.id}.continue")
                        .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { lab.event("button", "pinned.continue") },
                    contentAlignment = Alignment.Center,
                ) { Text("Continue", color = Color.White) }
            }
            "text-nav-cut" -> cell.targets.firstOrNull { it.tag == "T" }?.let { NavCut(cell, it, lab, bars.bottom) }
            else -> UnbuiltCell(cell)
        }
    }
    LaunchedEffect(Unit) {
        delay(800)
        lab.settled()
    }
}

/** One text target: its box with the string on it, one clickable node whose text is the string. */
@Composable
private fun TextTarget(cell: Cell, t: Target, lab: Lab, width: Dp, height: Dp, sp: Int, modifier: Modifier) {
    val view = LocalView.current
    Box(
        modifier
            .size(width, height)
            .onGloballyPositioned { c ->
                val r = screenFrame(view, c)
                lab.frame(t.tag, r)
                lab.frame("${t.tag}.box", r)
            }
            .testTag("lab.${cell.id}.${t.tag}")
            .background(Color(t.color))
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { lab.event("tap", t.tag) },
        contentAlignment = Alignment.Center,
    ) { Text(t.text ?: "", color = Color.Black, fontSize = sp.sp, maxLines = 1, overflow = TextOverflow.Clip) }
}

/** The node's height and its text box's, in pixels: Settings' cut row (49 of 74 px). */
private const val NODE_PX = 49
private const val TEXT_PX = 74

/**
 * `text-nav-cut`'s T: the node (its testTag, its tap) 49 px tall, its foot on the navigation band's top
 * (`navBottom` px above the screen's foot); its text box 74 px from the node's top, placed past the node's foot
 * unclipped (no clip anywhere above it), so it is drawn on into the band.
 */
@Composable
private fun NavCut(cell: Cell, t: Target, lab: Lab, navBottom: Int) {
    val view = LocalView.current
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val screenW = constraints.maxWidth
        val screenH = constraints.maxHeight
        val width = (screenW * 0.8).toInt()
        val x = (screenW - width) / 2
        val y = screenH - navBottom - NODE_PX
        Box(
            Modifier
                .offset { IntOffset(x, y) }
                .layout { m, _ ->
                    val p = m.measure(Constraints.fixed(width, NODE_PX))
                    layout(width, NODE_PX) { p.place(0, 0) }
                }
                .testTag("lab.${cell.id}.${t.tag}")
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { lab.event("tap", t.tag) },
        ) {
            Box(
                Modifier
                    .layout { m, c ->
                        val p = m.measure(Constraints.fixed(c.maxWidth, TEXT_PX))
                        layout(c.maxWidth, c.maxHeight) { p.place(0, 0) }
                    }
                    .onGloballyPositioned { c ->
                        val r = screenFrame(view, c)
                        lab.frame(t.tag, r)
                        lab.frame("${t.tag}.box", r)
                    }
                    .background(Color(t.color)),
                contentAlignment = Alignment.Center,
            ) { Text(t.text ?: "", color = Color.Black, fontSize = 18.sp, maxLines = 1) }
        }
    }
}
