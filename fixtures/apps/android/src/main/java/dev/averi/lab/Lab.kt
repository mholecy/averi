package dev.averi.lab

import android.content.Context
import android.graphics.Rect
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

// The lab app's model: the cell catalog it bundles (fixtures/apps/cells.json, copied into the assets at build time)
// and the state file it writes for the capture script (scripts/truth/schema.ts#LabState, the iOS app's shape) — the
// cell on screen, each target's frame as the app lays it out, whether the screen has settled, and every event a target
// or a layer received. Units are SCREEN PIXELS, as a uiautomator dump's bounds are: `scale` is 1.

/** The layers this app can build. A cell of another layer (one the iOS app gained first) is shown as unsupported. */
val SUPPORTED_LAYERS = setOf("none", "sheet-medium", "alert")

/** `text`: a text target (B5's own-parts) — this text drawn on its coloured control, the control's box `<tag>.box`. */
data class Target(val tag: String, val color: Long, val slot: Int, val onLayer: Boolean, val text: String? = null)

/** `family`: base, presented, forms, edges, bars, false-covers — MainActivity's CellRouter routes by it. */
data class Cell(val id: String, val layer: String, val targets: List<Target>, val family: String? = null) {
    val supported get() = layer in SUPPORTED_LAYERS
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
            Cell(c.optString("id"), c.optString("layer"), targets, c.optString("family").ifEmpty { null })
        }
    }
}

/**
 * The state file, `files/lab-state.json` in the app's data directory (read by `adb exec-out run-as dev.averi.lab cat
 * files/lab-state.json`). Written whole and renamed into place, so a reader never sees half a file. Main thread only.
 */
class Lab(context: Context, private val screen: Rect) {
    private val file = File(context.filesDir, "lab-state.json")
    private var cell = ""
    private var ready = false
    private val frames = linkedMapOf<String, Rect>()
    private val events = mutableListOf<JSONObject>()
    // Phase 3's geometry (scripts/truth/schema.ts#LabState): absent from the file on a cell that reports none.
    private var safeArea: Rect? = null
    private val scrollViews = linkedMapOf<String, Rect>()
    private val chrome = linkedMapOf<String, Rect>()

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
            .put("frames", JSONObject().apply { frames.forEach { (k, v) -> put(k, rect(v)) } })
            .put("events", JSONArray(events))
        safeArea?.let { json.put("safeArea", JSONObject().put("top", it.top).put("left", it.left).put("bottom", it.bottom).put("right", it.right)) }
        if (scrollViews.isNotEmpty()) json.put("scrollViews", JSONObject().apply { scrollViews.forEach { (k, v) -> put(k, rect(v)) } })
        if (chrome.isNotEmpty()) json.put("chrome", JSONObject().apply { chrome.forEach { (k, v) -> put(k, rect(v)) } })
        val tmp = File(file.parentFile, "lab-state.json.tmp")
        tmp.writeText(json.toString(2) + "\n")
        tmp.renameTo(file)
    }
}
