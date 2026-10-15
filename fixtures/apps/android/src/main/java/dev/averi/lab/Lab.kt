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

data class Target(val tag: String, val color: Long, val slot: Int, val onLayer: Boolean)

data class Cell(val id: String, val layer: String, val targets: List<Target>) {
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
                )
            }
            Cell(c.optString("id"), c.optString("layer"), targets)
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
        write()
    }

    /** The empty state of the catalog list (no cell asked for). */
    fun none() = show("", Cell("", "none", emptyList()))

    fun frame(tag: String, r: Rect) {
        if (frames[tag] == r) return
        frames[tag] = Rect(r)
        write()
    }

    fun settled() {
        ready = true
        write()
    }

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
        val tmp = File(file.parentFile, "lab-state.json.tmp")
        tmp.writeText(json.toString(2) + "\n")
        tmp.renameTo(file)
    }
}
