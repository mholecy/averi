package dev.averi.lab.rn

import android.os.Bundle
import android.view.MotionEvent
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

// The React Native lab app's one activity (README.md): edge to edge (gradle.properties `edgeToEdgeEnabled`), so the
// window is the screen and a layout frame is a screen frame. The cell to build is the intent extra `cell`
// (scripts/truth/lab-device.ts#AndroidLab.launch: `am start … --es cell <id>`), handed to App.tsx as its initial
// property `cell`.
class MainActivity : ReactActivity() {

  override fun getMainComponentName(): String = "AveriLabRN"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
      object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {
        override fun getLaunchOptions() = Bundle().apply { putString("cell", intent?.getStringExtra("cell") ?: "") }
      }

  override fun onCreate(savedInstanceState: Bundle?) {
    LabStateFile.open(this)
    super.onCreate(null)
  }

  /** Every touch the activity's window receives, before anything handles it (the probe's positive control). */
  override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
    if (ev.actionMasked == MotionEvent.ACTION_DOWN) LabStateFile.touched(ev.rawX, ev.rawY)
    return super.dispatchTouchEvent(ev)
  }
}
