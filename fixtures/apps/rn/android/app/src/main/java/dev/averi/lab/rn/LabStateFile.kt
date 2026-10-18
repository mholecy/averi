package dev.averi.lab.rn

import android.content.Context
import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Locale

/**
 * The lab's state file (scripts/truth/schema.ts#LabState), `files/lab-state.json` in the app's data directory — read by
 * `adb exec-out run-as dev.averi.lab.rn cat files/lab-state.json` (scripts/truth/lab-device.ts#AndroidLab.state), as the
 * Compose lab app's (fixtures/apps/android/…/Lab.kt). The JS model (src/lab.ts) hands its whole state over on every
 * change (`write`); this side keeps the touch log — every touch the activity's window receives, before anything
 * handles it (MainActivity.dispatchTouchEvent), in screen pixels — and writes the two merged, the events in time order,
 * whole and renamed into place, so a reader never sees half a file.
 */
object LabStateFile {
    private var file: File? = null
    private var snapshot: JSONObject? = null
    private val touches = mutableListOf<JSONObject>()

    fun open(context: Context) {
        file = File(context.filesDir, "lab-state.json")
    }

    @Synchronized
    fun write(json: String) {
        snapshot = JSONObject(json)
        flush()
    }

    /** A touch began at (x, y), screen pixels — the probe's positive control (`touch`, `x,y`, as Lab.kt's). */
    @Synchronized
    fun touched(x: Float, y: Float) {
        touches += JSONObject()
            .put("kind", "touch")
            .put("tag", String.format(Locale.ROOT, "%.0f,%.0f", x, y))
            .put("at", System.currentTimeMillis() / 1000.0)
        flush()
    }

    /** Nothing before the model's first state: a touch then is kept and written with it. */
    private fun flush() {
        val s = snapshot ?: return
        val target = file ?: return
        val state = JSONObject(s.toString())
        val own = state.optJSONArray("events") ?: JSONArray()
        val events = (0 until own.length()).map { own.getJSONObject(it) } + touches
        state.put("events", JSONArray(events.sortedBy { it.optDouble("at") }))
        val tmp = File(target.parentFile, "${target.name}.tmp")
        tmp.writeText(state.toString(2))
        tmp.renameTo(target)
    }
}

/** The JS model's way to the file: `NativeModules.LabStateFile.write(json)`. */
class LabStateModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = NAME

    @ReactMethod
    fun write(json: String) = LabStateFile.write(json)

    companion object {
        const val NAME = "LabStateFile"
    }
}

class LabStatePackage : BaseReactPackage() {
    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
        if (name == LabStateModule.NAME) LabStateModule(reactContext) else null

    override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
        mapOf(LabStateModule.NAME to ReactModuleInfo(LabStateModule.NAME, LabStateModule::class.java.name, false, false, false, false))
    }
}
