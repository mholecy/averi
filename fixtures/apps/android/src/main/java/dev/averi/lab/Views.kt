package dev.averi.lab

// The views family (fixtures/apps/cells/views.json, backlog D77): classic Android Views, the native twin of the React
// Native app's rn-banner (lab note LR4) and a target drawn over a later-listed control (D75's review round 1). AOSP
// sorts a classic ViewGroup's accessibility children by LOCATION (ViewGroup.ChildListForAccessibility's stripe
// comparator), so uiautomator lists each run below by where its children lie, never by the order they are drawn in:
// what averi's reading-order mark reads (src/adapters/android-accessibility-order.ts; docs/adr/0015-flat-list-reading-
// order-break.md, its amendment "Android Views list children by location").
//
// HOSTED BY THE ACTIVITY'S setContentView (MainActivity#host), NOT in Compose: an AndroidView sits under the node
// provider's host (AndroidComposeView, dumped as `android.view.View`), whose subtree the mark never reaches (ADR 0015's
// residual "Compose, and anything not location-sorted, stay on draw order") — hosted there, these cells would measure
// that residual instead of the mark (tests/ui-tree/draw-order-android-views-twin.test.ts, P2).
//
// Laid out in PIXELS from Base's slots (Base.kt: 300x64 dp, centred, the centre 142 + 180·slot dp down), each view at a
// fixed place in one full-screen FrameLayout; the predictions' geometry (1080x2220 at density 2.75) is in that test.

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.TextView
import androidx.compose.ui.unit.Dp
import kotlin.math.roundToInt

/** The views family's layout, in dp, beside Base.kt's slot (SLOT_WIDTH, SLOT_HEIGHT, slotTop). */
private object ViewsLayout {
    /**
     * views-banner's cover: 340x52, its offset from its target's top-left corner — 20 dp LEFT (listed first), and
     * 10 dp above its top (T, U) or below it (C), as rn-banner's COVERS (ReactNative.tsx).
     */
    const val COVER_WIDTH = 340
    const val COVER_HEIGHT = 52
    const val COVER_LEFT = -20
    val COVER_TOP = mapOf("T" to -10, "U" to -10, "C" to 10)
    const val COVER_COLOR = 0xFF263238

    /** views-drawn-over's B: 300x44, 20 dp right of A and 10 dp below its top — each holding the other's centre. */
    const val UNDER_RIGHT = 20
    const val UNDER_TOP = 10
    const val UNDER_HEIGHT = 44

    /** A2's translationZ over B2. */
    const val RAISE = 8
}

/**
 * The views family's screen for `cell`: its run of classic Views, each target's frame (and each cover's) reported. A
 * cell this file does not build, or one whose declared target it does not place (a renamed tag), is said on screen and
 * NEVER marked ready, as MainActivity's UnbuiltCell: a capture of it times out naming the cell.
 */
fun viewsScreen(activity: Activity, cell: Cell, lab: Lab): View {
    val density = activity.resources.displayMetrics.density
    val px = { dp: Int -> (dp * density).roundToInt() }
    val pxOf = { dp: Dp -> (dp.value * density).roundToInt() }
    val screenWidth = activity.windowManager.maximumWindowMetrics.bounds.width()
    // Centred as Base.kt centres a slot — in dp, then rounded: 127 px on averi_lab (1080 px at density 2.75; in Float
    // 127.49998), where Base's targets lie (tests/fixtures/truth/android-averi_lab-api33/open.state.json); React
    // Native's rn-banner, rounding its own way, lies at 128.
    val left = ((screenWidth / density - SLOT_WIDTH.value) / 2 * density).roundToInt()
    val slotWidth = pxOf(SLOT_WIDTH)
    val run = FrameLayout(activity).apply { setBackgroundColor(Color.WHITE) }
    identifiedAs(run, "lab.${cell.id}.run")
    val reported = linkedMapOf<String, View>()
    val place = { v: View, x: Int, y: Int, w: Int, h: Int ->
        run.addView(v, FrameLayout.LayoutParams(w, h).apply { gravity = Gravity.TOP or Gravity.START; leftMargin = x; topMargin = y })
    }
    val target = { t: Target ->
        FrameLayout(activity).apply {
            setBackgroundColor(t.color.toInt())
            setOnClickListener { lab.event("tap", t.tag) }
            identifiedAs(this, "lab.${cell.id}.${t.tag}")
            reported[t.tag] = this
        }
    }
    when (cell.id) {
        "views-banner" -> for (t in cell.targets) {
            // A tag with no cover offset is placed by no view: the cell is then unbuilt (the unplaced check below).
            val coverOffset = ViewsLayout.COVER_TOP[t.tag] ?: continue
            // The target, then its cover as the LATER child: drawn over it.
            val top = pxOf(slotTop(t.slot))
            place(target(t), left, top, slotWidth, pxOf(SLOT_HEIGHT))
            val cover = bannerCover(activity, cell, t, px)
            reported["${t.tag}.cover"] = cover
            // In px each side rounded half up, as Kotlin's roundToInt: -27.5 → -27 (276, 771 on averi_lab, where
            // rn-banner.xml has its covers), 27.5 → 28 (1321).
            val coverTop = top + px(coverOffset)
            place(cover, left + px(ViewsLayout.COVER_LEFT), coverTop, px(ViewsLayout.COVER_WIDTH), px(ViewsLayout.COVER_HEIGHT))
        }
        "views-drawn-over" -> {
            val byTag = cell.targets.associateBy { it.tag }
            for ((over, under, raised) in listOf(Triple("A", "B", false), Triple("A2", "B2", true))) {
                val a = byTag[over] ?: continue
                val b = byTag[under] ?: continue
                val top = pxOf(slotTop(a.slot))
                val aView = target(a)
                val bView = target(b)
                val placeA = { place(aView, left, top, slotWidth, pxOf(SLOT_HEIGHT)) }
                val placeB = { place(bView, left + px(ViewsLayout.UNDER_RIGHT), top + px(ViewsLayout.UNDER_TOP), slotWidth, px(ViewsLayout.UNDER_HEIGHT)) }
                if (raised) {
                    // A2 the EARLIER child, drawn (and touched) over B2 by its Z: ViewGroup orders drawing and touch
                    // dispatch by Z first. No outline, so no shadow pixels around it.
                    aView.translationZ = px(ViewsLayout.RAISE).toFloat()
                    aView.outlineProvider = null
                    placeA()
                    placeB()
                } else {
                    // A the LATER child: drawn over B by child order.
                    placeB()
                    placeA()
                }
            }
        }
        else -> return unbuilt(activity, cell)
    }
    val unplaced = cell.targets.map { it.tag }.filter { it !in reported }
    if (unplaced.isNotEmpty()) return unbuilt(activity, cell, "its ${unplaced.joinToString()} placed by no view")
    // Per view, not the window's ViewTreeObserver (which outlives this cell's views in the process).
    run.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> for ((tag, v) in reported) lab.frame(tag, onScreen(v)) }
    // Ready once laid out and drawn, as the Compose cells (Presented.kt#PresentedLayer: 600 ms for a cell of no layer);
    // never for a run another cell has replaced.
    run.postDelayed({ if (run.isAttachedToWindow) lab.settled() }, 600)
    return run
}

/** A views cell this file cannot build, said on screen and never ready (MainActivity's UnbuiltCell). */
private fun unbuilt(activity: Activity, cell: Cell, why: String = "no view of family ${cell.family} builds it yet"): View =
    TextView(activity).apply {
        text = "Cell ${cell.id}: $why"
        setBackgroundColor(Color.WHITE)
        setPadding(48, 160, 48, 0)
    }

/**
 * views-banner's cover of `t`: opaque, no clickable node, swallowing every touch (a touch on it reaches no target, as
 * rn-banner's cover reaches no Pressable). T's a TextView `Saved` (a toast), the others a bare FrameLayout with an
 * identifier only.
 */
@SuppressLint("ClickableViewAccessibility")
private fun bannerCover(activity: Activity, cell: Cell, t: Target, px: (Int) -> Int): View {
    val cover = if (t.tag == "T") {
        TextView(activity).apply {
            text = "Saved"
            setTextColor(Color.WHITE)
            textSize = 15f
            gravity = Gravity.CENTER_VERTICAL
            setPadding(px(16), 0, 0, 0)
        }
    } else {
        FrameLayout(activity)
    }
    cover.setBackgroundColor(ViewsLayout.COVER_COLOR.toInt())
    cover.setOnTouchListener { _, _ -> true }
    identifiedAs(cover, "lab.${cell.id}.${t.tag}.cover")
    return cover
}
