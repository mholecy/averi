@file:OptIn(ExperimentalComposeUiApi::class)

package dev.averi.lab

// The held family (fixtures/apps/cells/held.json, backlog D30): a screen that renders late, for the live golden's
// `ensure` group (scripts/truth/live-ensure.ts) — ensure_state's second look on a device, ADR 0033's held "no".
//
// - `held-no`: ready at once while it draws nothing — plain white, no semantics node: a bare dump (the decor chain
//   alone, src/ui-tree/bare-tree.ts) — for 6 s (long, so the launch rarely outruns the call); then Text "Welcome"
//   and Button "Continue"; Continue shows Text "Home".
// - `held-no-spinner`: the same, with 4 s of an unlabelled CircularProgressIndicator between the bare phase and Welcome.
//
// Each element is identified lab.<cell>.<tag> (welcome, continue, home). Every phase change is logged (`phase`, `bare`
// / `spinner` / `welcome` / `home`) before it is drawn, Continue's press as the `tap` `continue` — the judges' clock.

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

@Composable
internal fun HeldScreen(cell: Cell, lab: Lab) {
    var phase by remember { mutableStateOf("bare") }
    /** The next phase, logged before it is drawn. */
    fun show(next: String) {
        lab.event("phase", next)
        phase = next
    }
    Box(Modifier.fillMaxSize().background(Color.White).semantics { testTagsAsResourceId = true }, contentAlignment = Alignment.Center) {
        when (phase) {
            "spinner" -> CircularProgressIndicator()
            "welcome" -> Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(24.dp)) {
                Text("Welcome", style = MaterialTheme.typography.headlineLarge, modifier = Modifier.testTag("lab.${cell.id}.welcome"))
                Button({
                    lab.event("tap", "continue")
                    show("home")
                }, Modifier.testTag("lab.${cell.id}.continue")) { Text("Continue") }
            }
            "home" -> Text("Home", style = MaterialTheme.typography.headlineLarge, modifier = Modifier.testTag("lab.${cell.id}.home"))
        }
    }
    LaunchedEffect(Unit) {
        lab.event("phase", "bare")
        // Ready while nothing is drawn: the launch returns into the bare phase.
        lab.settled()
        delay(6_000)
        if (cell.id == "held-no-spinner") {
            show("spinner")
            delay(4_000)
        }
        show("welcome")
    }
}
