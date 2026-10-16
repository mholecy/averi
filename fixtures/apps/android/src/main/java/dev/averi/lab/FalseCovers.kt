@file:OptIn(ExperimentalComposeUiApi::class)

package dev.averi.lab

// The false-covers family (fixtures/apps/cells/false-covers.json): what lies over a target in a tree yet is no cover.
// Android builds `own-parts` — text targets (CatalogTarget.text) drawn on their own control: `L` a Material button's
// own label (a Compose button lists its text before an unlabelled clickable of its size: calibration.json #8), `N` a
// text field's own label with the empty field over it (#18's shape on iOS). A tap on either text fires its control,
// logged as the target's `tap`. The toolbar cells are form cells: phase 2b on Android (the capture skips them).

import android.graphics.Rect
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlin.math.roundToInt

/** The slots of Base.kt (TargetBox): 300×64 dp, centred, the centre 142 + 180·slot dp down. */
private val PART_WIDTH = 300.dp
private val PART_HEIGHT = 64.dp

@Composable
internal fun FalseCoversScreen(cell: Cell, lab: Lab) {
    BoxWithConstraints(Modifier.fillMaxSize().background(Color.White).semantics { testTagsAsResourceId = true }) {
        for (t in cell.targets) {
            OwnPart(cell, t, lab, Modifier.offset(x = (maxWidth - PART_WIDTH) / 2, y = (142 + 180 * t.slot).dp - PART_HEIGHT / 2))
        }
    }
    LaunchedEffect(Unit) {
        delay(600)
        lab.settled()
    }
}

/** The node's frame in SCREEN pixels, reported as `tag` (as TargetBox reports its own). */
@Composable
private fun Modifier.reportFrame(tag: String, lab: Lab): Modifier {
    val view = LocalView.current
    return onGloballyPositioned { c ->
        val at = IntArray(2).also(view::getLocationOnScreen)
        val b = c.boundsInWindow()
        lab.frame(tag, Rect(at[0] + b.left.roundToInt(), at[1] + b.top.roundToInt(), at[0] + b.right.roundToInt(), at[1] + b.bottom.roundToInt()))
    }
}

@Composable
private fun OwnPart(cell: Cell, t: Target, lab: Lab, modifier: Modifier) {
    val id = "lab.${cell.id}.${t.tag}"
    val box = modifier.size(PART_WIDTH, PART_HEIGHT).reportFrame("${t.tag}.box", lab)
    if (t.tag == "L") {
        Button(
            onClick = { lab.event("tap", t.tag) },
            modifier = box.testTag("$id.box"),
            shape = RectangleShape,
            colors = ButtonDefaults.buttonColors(containerColor = Color(t.color), contentColor = Color.White),
            elevation = null,
            contentPadding = PaddingValues(0.dp),
        ) {
            Text(t.text ?: "", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.testTag(id).reportFrame(t.tag, lab))
        }
    } else {
        var value by remember { mutableStateOf("") }
        Box(box.background(Color(t.color)).testTag("$id.box"), contentAlignment = Alignment.CenterStart) {
            Text(t.text ?: "", fontSize = 15.sp, modifier = Modifier.padding(start = 18.dp).height(22.dp).testTag(id).reportFrame(t.tag, lab))
            BasicTextField(
                value = value,
                onValueChange = { value = it },
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 18.dp)
                    .height(20.dp)
                    .testTag("$id.field")
                    .onFocusChanged { if (it.isFocused) lab.event("tap", t.tag) },
            )
        }
    }
}
