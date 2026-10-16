package dev.averi.lab

import android.content.Context
import android.graphics.Rect
import android.view.View
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.systemBars
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.LayoutDirection
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.math.roundToInt

// The lab app's model: the cell catalog it bundles (fixtures/apps/cells.json, copied into the assets at build time)
// and the state file it writes for the capture script (scripts/truth/schema.ts#LabState, the iOS app's shape) — the
// cell on screen, each target's frame as the app lays it out, whether the screen has settled, and every event a target
// or a layer received. Units are SCREEN PIXELS, as a uiautomator dump's bounds are: `scale` is 1.

/** The layers this app can build. A cell of another layer (one the iOS app gained first) is shown as unsupported. */
val SUPPORTED_LAYERS = setOf("none", "sheet-medium", "alert")

/** `text`: a text target (B5's own-parts) — this text drawn on its coloured control, the control's box `<tag>.box`. */
data class Target(val tag: String, val color: Long, val slot: Int, val onLayer: Boolean, val text: String? = null)

/**
 * `family`: base, presented, forms, edges, bars, false-covers — MainActivity's CellRouter routes by it. `form`: a form
 * cell's catalog entry as it stands (Forms.kt reads it) — a form builds its own picker sheet, so its `sheet-large` is
 * supported where a coloured-target cell's is not.
 */
data class Cell(val id: String, val layer: String, val targets: List<Target>, val family: String? = null, val form: JSONObject? = null) {
    val supported get() = layer in SUPPORTED_LAYERS || (form != null && layer == "sheet-large")
}

/**
 * The bundled catalog, read leniently: the catalog grows with cells and fields this app may not know yet (the form
 * cells), so a cell without `targets` has none, an unknown field is ignored, and only `in: "layer"` puts a target on
 * the layer — nothing in a newer catalog makes the app crash.
 */
object Catalog {
    fun load(context: Context): List<Cell> {
        val root = JSONObject(context.assets.open("cells.json").bufferedReader().use { it.readText() })
        val cells = root.optJSONArray("cells") ?: JSONArray()
        return (0 until cells.length()).mapNotNull { i ->
            val c = cells.optJSONObject(i) ?: return@mapNotNull null
            val ts = c.optJSONArray("targets") ?: JSONArray()
            val targets = (0 until ts.length()).mapNotNull { j ->
                val t = ts.optJSONObject(j) ?: return@mapNotNull null
                val hex = t.optString("color", "#000000").removePrefix("#")
                Target(
                    tag = t.optString("tag"),
                    color = 0xFF000000L or (hex.toLongOrNull(16) ?: 0L),
                    slot = t.optInt("slot", 0),
                    onLayer = t.optString("in") == "layer",
                    text = t.optString("text").ifEmpty { null },
                )
            }
            Cell(c.optString("id"), c.optString("layer"), targets, c.optString("family").ifEmpty { null }, c.optJSONObject("form"))
        }
    }
}

/**
 * The state file, `files/lab-state.json` in the app's data directory (read by `adb exec-out run-as dev.averi.lab cat
 * files/lab-state.json`). Written whole and renamed into place, so a reader never sees half a file. Main thread only.
 */
class Lab(context: Context, private val screen: Rect) {
    private val file = File(context.filesDir, "lab-state.json")
    /** Pixels per dp — the state's `density`: what Android's 48-dp minimum touch target is in the state's units. */
    private val density = context.resources.displayMetrics.density
    private var cell = ""
    private var ready = false
    private val frames = linkedMapOf<String, Rect>()
    private val events = mutableListOf<JSONObject>()
    // Phase 3's geometry (scripts/truth/schema.ts#LabState): absent from the file on a cell that reports none.
    private var safeArea: Rect? = null
    private val scrollViews = linkedMapOf<String, Rect>()
    private val chrome = linkedMapOf<String, Rect>()
    // Phase 5's live oracle (scripts/truth/live.ts; schema.ts#LabState's offsets, strokes): absent from the file on a
    // cell with no scroll container that reports them.
    private val offsets = linkedMapOf<String, Int>()
    private val strokes = JSONArray()
    private val strokeFrom = mutableMapOf<String, Int>()
    /** Where each container last came to rest: a stroke's `from` (its offset may move in the frame it starts). */
    private val rest = mutableMapOf<String, Int>()
    // A form cell's oracle (Forms.kt; scripts/truth/schema.ts#LabState's fields, focus, keyboard, submits): null — absent
    // from the file — on every other cell.
    private var fields: LinkedHashMap<String, JSONObject>? = null
    private var focus: String? = null
    private var keyboard: JSONObject? = null
    private var submits: JSONArray? = null

    /** A fresh state for `id` (`unknown:<id>` / `unsupported:<id>` when this app cannot show it). */
    fun show(id: String, found: Cell?) {
        cell = when {
            found == null -> "unknown:$id"
            !found.supported -> "unsupported:$id"
            else -> id
        }
        ready = false
        frames.clear()
        events.clear()
        safeArea = null
        scrollViews.clear()
        chrome.clear()
        offsets.clear()
        while (strokes.length() > 0) strokes.remove(0)
        strokeFrom.clear()
        rest.clear()
        fields = if (found?.form != null) linkedMapOf() else null
        focus = null
        keyboard = null
        submits = if (found?.form != null) JSONArray() else null
        write()
    }

    /** The empty state of the catalog list (no cell asked for). */
    fun none() = show("", Cell("", "none", emptyList()))

    fun frame(tag: String, r: Rect) {
        if (frames[tag] == r) return
        frames[tag] = Rect(r)
        write()
    }

    /** The system bars' insets in pixels (left, top, right, bottom as a Rect's fields) — the state's `safeArea`. */
    fun safeArea(insets: Rect) {
        if (safeArea == insets) return
        safeArea = Rect(insets)
        write()
    }

    /** A scroll container's clip on the screen, by the id the catalog's targets name (`scrollView`). */
    fun scrollView(id: String, r: Rect) {
        if (scrollViews[id] == r) return
        scrollViews[id] = Rect(r)
        write()
    }

    /** App UI drawn over content (a sticky header, a bar), by name, its frame on the screen. */
    fun chrome(name: String, r: Rect) {
        if (chrome[name] == r) return
        chrome[name] = Rect(r)
        write()
    }

    // --- phase 5's live oracle: where each scroll container is, and each stroke it took ---

    /**
     * A scroll container's state, read in one snapshot: its content offset (pixels down its content, 0 its top) and
     * whether it is scrolling. A stroke runs from where it last rested to where it comes to rest — a drag and the fling
     * after it are one stroke.
     */
    fun scroll(id: String, moving: Boolean, px: Int) {
        if (moving) {
            strokeFrom.putIfAbsent(id, rest[id] ?: px)
        } else {
            rest[id] = px
            strokeFrom.remove(id)?.let { from ->
                strokes.put(JSONObject().put("view", id).put("from", from).put("to", px).put("at", System.currentTimeMillis() / 1000.0))
            }
        }
        if (offsets[id] == px && moving) return
        offsets[id] = px
        write()
    }

    // --- the form oracle (Forms.kt): what the MODEL holds, never what a tree reports ---

    /** One field as the model holds it: its value, whether it has the focus, the error it shows (text and id) or none. */
    fun field(tag: String, value: String, focused: Boolean, error: Pair<String, String>?) {
        val f = JSONObject().put("value", value).put("focused", focused)
            .put("error", error?.let { JSONObject().put("text", it.first).put("id", it.second) } ?: JSONObject.NULL)
        val all = fields ?: return
        if (all[tag]?.toString() == f.toString()) return
        all[tag] = f
        write()
    }

    /** The field holding the focus (null: none) — a `focus` event, `tag` empty for none. */
    fun focused(tag: String?) {
        if (focus == tag) return
        focus = tag
        event("focus", tag ?: "")
    }

    /**
     * The IME's frame on the screen in pixels, from Compose's WindowInsets.ime (its bottom inset: the keyboard spans the
     * screen's width from `screen.bottom - inset` down), `visible` while the inset is not 0, and the field focused when
     * it changed — the one it serves.
     */
    fun keyboard(frame: Rect, visible: Boolean) {
        val k = JSONObject().put("frame", rect(frame)).put("visible", visible).put("field", focus ?: JSONObject.NULL)
        if (keyboard?.toString() == k.toString()) return
        keyboard = k
        write()
    }

    fun submit(valid: Boolean, values: Map<String, String>) {
        val now = System.currentTimeMillis() / 1000.0
        submits?.put(JSONObject().put("at", now).put("valid", valid).put("values", JSONObject(values)))
        event("submit", if (valid) "valid" else "invalid")
    }

    fun settled() {
        ready = true
        write()
    }

    /**
     * A touch began at (x, y), screen pixels, in one of the app's windows — the probe's positive control (`touch`,
     * `x,y`).
     */
    fun touched(x: Float, y: Float) = event("touch", String.format(java.util.Locale.ROOT, "%.0f,%.0f", x, y))

    fun event(kind: String, tag: String) {
        events += JSONObject().put("kind", kind).put("tag", tag).put("at", System.currentTimeMillis() / 1000.0)
        write()
    }

    private fun rect(r: Rect) = JSONObject().put("x", r.left).put("y", r.top).put("width", r.width()).put("height", r.height())

    private fun write() {
        val json = JSONObject()
            .put("cell", cell)
            .put("ready", ready)
            .put("screen", rect(screen))
            .put("scale", 1)
            .put("density", density.toDouble())
            .put("frames", JSONObject().apply { frames.forEach { (k, v) -> put(k, rect(v)) } })
            .put("events", JSONArray(events))
        safeArea?.let { json.put("safeArea", JSONObject().put("top", it.top).put("left", it.left).put("bottom", it.bottom).put("right", it.right)) }
        if (scrollViews.isNotEmpty()) json.put("scrollViews", JSONObject().apply { scrollViews.forEach { (k, v) -> put(k, rect(v)) } })
        if (chrome.isNotEmpty()) json.put("chrome", JSONObject().apply { chrome.forEach { (k, v) -> put(k, rect(v)) } })
        if (offsets.isNotEmpty()) json.put("offsets", JSONObject().apply { offsets.forEach { (k, v) -> put(k, v) } })
        if (strokes.length() > 0) json.put("strokes", JSONArray(strokes.toString()))
        fields?.let { all ->
            json.put("fields", JSONObject().apply { all.forEach { (k, v) -> put(k, v) } })
            json.put("focus", focus ?: JSONObject.NULL)
            json.put("keyboard", keyboard ?: JSONObject.NULL)
            json.put("submits", submits)
        }
        val tmp = File(file.parentFile, "lab-state.json.tmp")
        tmp.writeText(json.toString(2) + "\n")
        tmp.renameTo(file)
    }
}

// --- phase 3's geometry, read once for every family that reports it (Edges.kt, Bars.kt) ---

/**
 * A layout's frame on the SCREEN, unclipped: its position in the window plus the window's place on the screen, and its
 * laid-out size — a row cut by its scroll container, or off the screen, keeps its whole frame (boundsInWindow would
 * clip it), so the truth sees where the frame runs on past the clip.
 */
fun screenFrame(view: View, c: LayoutCoordinates): Rect {
    val at = IntArray(2).also(view::getLocationOnScreen)
    val p = c.positionInWindow()
    val x = at[0] + p.x.roundToInt()
    val y = at[1] + p.y.roundToInt()
    return Rect(x, y, x + c.size.width, y + c.size.height)
}

/**
 * The system bars' insets in pixels (left, top, right, bottom as a Rect's fields), as Compose dispatches them to the
 * edge-to-edge window (MainActivity's enableEdgeToEdge) — reported to the state's `safeArea` each time they change,
 * and returned for a layout laid against the bars.
 */
@Composable
fun systemBarsInsets(lab: Lab): Rect {
    val d = LocalDensity.current
    val i = WindowInsets.systemBars
    val r = Rect(i.getLeft(d, LayoutDirection.Ltr), i.getTop(d), i.getRight(d, LayoutDirection.Ltr), i.getBottom(d))
    LaunchedEffect(r) { lab.safeArea(r) }
    return r
}

/**
 * Reports a scroll container's content offset and its strokes to the lab under `id` (Lab.scroll): the
 * live golden's oracle of which container a stroke moved, and which way. `offset` and `moving` are read as snapshot
 * state (ScrollState.value / isScrollInProgress, a LazyListState's).
 */
@Composable
fun ReportScroll(lab: Lab, id: String, moving: () -> Boolean, offset: () -> Int) {
    LaunchedEffect(lab, id) { snapshotFlow { moving() to offset() }.collect { (m, o) -> lab.scroll(id, m, o) } }
}
