@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalComposeUiApi::class)

package dev.averi.lab

// The forms family (fixtures/apps/cells/forms.json) on Android — phase 2b of docs/plans/2026-10-15-ground-truth-lab-
// app.md, the iOS app's Forms.swift in Compose: the fields of a payment form, a submit, maybe a country picker sheet,
// laid out as a banking app lays them out (a top bar, a scroll column, titles above the fields, errors under them),
// every one reporting to the oracle (Lab.kt#field): the value the MODEL holds, the focus, the error it shows and the
// identifier it shows it under. A fill is judged by that, never by a tree.
//
// Nothing here transforms what is typed (no capitalisation, no autocorrection, no mask): a value that does not land as
// typed is averi's or adb's doing, not the app's.
//
// The keyboard: the window gets the IME's insets (adjustResize under edge to edge: nothing is resized or panned) and
// the form does NOT make room for it — the scroll column keeps its whole height, so the fields laid where the IME is
// drawn stay where they were, under it, and listed (an mp-native form's shape: docs/bugs/2026-10-06-pixel-assert-
// measures-the-keyboard-over-its-element.md). Only a pinned submit's bar rides above the IME (its bottom padding the
// IME's inset), as iOS's safe-area inset does. The bar's frame is reported as `submit.bar` (what truth.ts#situationOf
// reads as the bar's cover), the IME's as the state's `keyboard`, from WindowInsets.ime.

import android.app.Activity
import android.graphics.Rect
import android.view.WindowManager
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import org.json.JSONObject

// --- the catalog's form entry (scripts/truth/schema.ts#CatalogForm), read leniently ---

internal data class Message(val text: String, val id: String)
internal data class FieldSpec(
    val tag: String,
    val kind: String,
    val title: String,
    val titleId: String?,
    val fieldId: String?,
    val placeholder: String,
    val prefill: String?,
    val error: Message?,
)
internal data class PickerRow(val code: String, val name: String)
internal data class PickerSpec(val field: String, val title: String, val open: Boolean, val rows: List<PickerRow>)
internal data class FormSpec(
    val title: String,
    val titleId: String?,
    val floatingTitles: Boolean,
    val fields: List<FieldSpec>,
    val submitTag: String,
    val submitTitle: String,
    val pinned: Boolean,
    val screenError: Message?,
    val submitOnAppear: Boolean,
    val focus: String?,
    val picker: PickerSpec?,
)

private fun JSONObject.str(key: String): String? = if (has(key) && !isNull(key)) optString(key) else null
private fun message(o: JSONObject?): Message? = o?.let { Message(it.optString("text"), it.optString("id")) }

internal fun formOf(o: JSONObject): FormSpec {
    val fs = o.optJSONArray("fields")
    val fields = (0 until (fs?.length() ?: 0)).map { i ->
        val f = fs!!.getJSONObject(i)
        FieldSpec(f.optString("tag"), f.optString("kind"), f.optString("title"), f.str("titleId"), f.str("fieldId"), f.optString("placeholder"), f.str("prefill"), message(f.optJSONObject("error")))
    }
    val s = o.optJSONObject("submit") ?: JSONObject()
    val picker = o.optJSONObject("picker")?.let { p ->
        val rs = p.optJSONArray("rows")
        PickerSpec(p.optString("field"), p.optString("title"), p.optBoolean("open"), (0 until (rs?.length() ?: 0)).map { i -> rs!!.getJSONObject(i).let { PickerRow(it.optString("code"), it.optString("name")) } })
    }
    return FormSpec(
        title = o.optString("title"),
        titleId = o.str("titleId"),
        floatingTitles = o.optBoolean("floatingTitles"),
        fields = fields,
        submitTag = s.optString("tag", "submit"),
        submitTitle = s.optString("title"),
        pinned = s.optBoolean("pinned"),
        screenError = message(o.optJSONObject("screenError")),
        submitOnAppear = o.optBoolean("submitOnAppear"),
        focus = o.str("focus"),
        picker = picker,
    )
}

@Composable
internal fun FormsScreen(cell: Cell, lab: Lab) {
    val form = cell.form?.let(::formOf)
    if (form == null) UnbuiltCell(cell) else FormScreen(cell, form, lab)
}

private val BAR = Color(0xFFF2F2F7)
private val BORDER = Color(0xFFB0B0B8)
private val ERROR = Color(0xFFD32F2F)

/** Reports a layout's unclipped frame on the screen, in pixels (Lab.kt#screenFrame). */
@Composable
private fun reporting(report: (Rect) -> Unit): Modifier {
    val view = LocalView.current
    return Modifier.onGloballyPositioned { c -> report(screenFrame(view, c)) }
}

@Composable
private fun FormScreen(cell: Cell, form: FormSpec, lab: Lab) {
    val values = remember { mutableStateMapOf<String, String>() }
    /** A submit has run: an invalid field shows its error from now on (and loses it once fixed). */
    var dirty by remember { mutableStateOf(false) }
    var picker by remember { mutableStateOf(false) }
    var focus by remember { mutableStateOf<String?>(null) }
    val requesters = remember { form.fields.associate { it.tag to FocusRequester() } }
    val focusManager = LocalFocusManager.current
    val keyboardController = LocalSoftwareKeyboardController.current
    val fieldID = { f: FieldSpec -> f.fieldId ?: "lab.${cell.id}.${f.tag}" }

    // --- validation: a banking form's, small and transparent (Forms.swift's) ---
    fun invalid(f: FieldSpec): Boolean {
        val v = (values[f.tag] ?: "").trim()
        return when (f.kind) {
            "email" -> !(v.contains("@") && v.contains("."))
            "iban" -> {
                val compact = v.replace(" ", "")
                compact.length < 15 || !compact.take(2).all { it.isLetter() }
            }
            "amount" -> {
                val n = v.replace(" ", "").replace(" ", "").replace(",", ".").toDoubleOrNull()
                n == null || n <= 0 || n > 10_000
            }
            "pin" -> v.length != 4 || !v.all { it.isDigit() }
            else -> v.isEmpty()
        }
    }
    val allValid = form.fields.none { invalid(it) }
    fun shownError(f: FieldSpec): Message? = if (!dirty || !invalid(f)) null else f.error ?: Message("Required", "${fieldID(f)}_error")
    fun submit() {
        dirty = true
        lab.submit(form.fields.none { invalid(it) }, form.fields.associate { it.tag to (values[it.tag] ?: "") })
    }

    // The window gets the IME's insets and is neither resized nor panned (see the file's head).
    val activity = LocalContext.current as? Activity
    DisposableEffect(activity) {
        val window = activity?.window
        val before = window?.attributes?.softInputMode
        window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        onDispose { if (before != null) window.setSoftInputMode(before) }
    }

    // The oracle: every field as the model holds it, after each change.
    form.fields.forEach { f ->
        val value = values[f.tag] ?: ""
        val focused = focus == f.tag
        val error = shownError(f)
        LaunchedEffect(value, focused, error) { lab.field(f.tag, value, focused, error?.let { it.text to it.id }) }
    }
    LaunchedEffect(focus) { lab.focused(focus) }

    // The IME's frame, from its inset (Lab.kt#keyboard): reported once it has been up, as iOS reports the keyboard's
    // frame from its first change on.
    val density = LocalDensity.current
    val view = LocalView.current
    val ime = WindowInsets.ime.getBottom(density)
    var imeSeen by remember { mutableStateOf(false) }
    LaunchedEffect(ime) {
        if (ime > 0) imeSeen = true
        if (!imeSeen) return@LaunchedEffect
        val w = view.rootView.width
        val h = view.rootView.height
        lab.keyboard(Rect(0, h - ime, w, h), ime > 0)
    }

    Box(Modifier.fillMaxSize().background(Color.White).semantics { testTagsAsResourceId = true }) {
        Column(Modifier.fillMaxSize()) {
            // The top bar: the title, centred; a principal title with an identifier ends the editing when tapped.
            Box(Modifier.fillMaxWidth().background(BAR).statusBarsPadding().height(56.dp), contentAlignment = Alignment.Center) {
                val id = form.titleId
                if (id != null) {
                    Text(
                        form.title,
                        fontSize = 17.sp,
                        modifier = Modifier.testTag(id).then(reporting { lab.frame("title", it) })
                            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { focusManager.clearFocus() },
                    )
                } else {
                    Text(form.title, fontSize = 17.sp)
                }
            }
            Column(
                Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, top = 34.dp, bottom = 12.dp),
                // Compact, so the keyboard cell's fields fall as iOS's do: postcode (focused) open above the bar riding
                // on the IME, phone and vs straddling the bar and the IME's top, ks, ss and note under the IME.
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                for (f in form.fields) {
                    FieldRow(cell, form, f, lab, fieldID(f), values[f.tag] ?: "", shownError(f), requesters.getValue(f.tag),
                        onValue = { values[f.tag] = it },
                        onFocus = { has -> if (has) focus = f.tag else if (focus == f.tag) focus = null },
                        onCountry = {
                            lab.event("tap", f.tag)
                            picker = true
                        })
                }
                if (!form.pinned) SubmitButton(cell, form, lab, Modifier.padding(top = 8.dp)) { submit() }
                val e = form.screenError
                if (dirty && !allValid && e != null) {
                    // A screen-level message, far under the last field: no field's error.
                    Text(e.text, color = ERROR, fontSize = 15.sp, modifier = Modifier.padding(top = 40.dp).testTag(e.id).then(reporting { lab.frame("screenError", it) }))
                }
                // Room for the pinned bar at rest, so the last field can be scrolled clear of it.
                if (form.pinned) Box(Modifier.height(80.dp))
            }
        }
        if (form.pinned) {
            // Rides above the IME (or the navigation band): its bottom padding the larger of the two insets.
            Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().windowInsetsPadding(WindowInsets.ime.union(WindowInsets.navigationBars).only(WindowInsetsSides.Bottom))) {
                Box(Modifier.fillMaxWidth().background(BAR).then(reporting { lab.frame("${form.submitTag}.bar", it) }).padding(horizontal = 20.dp, vertical = 10.dp)) {
                    SubmitButton(cell, form, lab) { submit() }
                }
            }
        }
    }

    val p = form.picker
    if (picker && p != null) {
        PickerSheet(cell, p, lab, onPick = { r ->
            values[p.field] = r.name
            lab.event("select", r.code)
            picker = false
        }, onDismiss = {
            picker = false
            lab.event("dismissed", "sheet")
        })
    }

    LaunchedEffect(Unit) {
        for (f in form.fields) f.prefill?.let { values[f.tag] = it }
        // As an app raises them: after the screen has appeared. Ready once the keyboard or the sheet has had time to
        // finish animating in.
        delay(300)
        if (form.submitOnAppear) submit()
        form.focus?.let { tag ->
            requesters[tag]?.requestFocus()
            keyboardController?.show()
        }
        if (p?.open == true) picker = true
        val raised = form.focus != null || p?.open == true
        delay(if (raised) 1500 else 500)
        lab.settled()
    }
}

@Composable
private fun FieldRow(
    cell: Cell,
    form: FormSpec,
    f: FieldSpec,
    lab: Lab,
    id: String,
    value: String,
    error: Message?,
    requester: FocusRequester,
    onValue: (String) -> Unit,
    onFocus: (Boolean) -> Unit,
    onCountry: () -> Unit,
) {
    val titleId = f.titleId ?: "$id.title"
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        if (form.floatingTitles) {
            // A design-system component (FE2): the title floats in the component's top, the input under it, the two
            // overlapping by a few dp — the title reaches into the field's frame.
            Box {
                Input(cell, f, lab, id, value, requester, onValue, onFocus, onCountry, Modifier.padding(top = 10.dp))
                Text(f.title, fontSize = 12.sp, color = Color.Gray, modifier = Modifier.padding(start = 8.dp).testTag(titleId).then(reporting { lab.frame("${f.tag}.title", it) }))
            }
        } else {
            Text(f.title, fontSize = 12.sp, modifier = Modifier.testTag(titleId).then(reporting { lab.frame("${f.tag}.title", it) }))
            Input(cell, f, lab, id, value, requester, onValue, onFocus, onCountry, Modifier)
        }
        if (error != null) {
            Text(error.text, color = ERROR, fontSize = 13.sp, modifier = Modifier.testTag(error.id).then(reporting { lab.frame("${f.tag}.error", it) }))
        }
    }
}

@Composable
private fun Input(
    cell: Cell,
    f: FieldSpec,
    lab: Lab,
    id: String,
    value: String,
    requester: FocusRequester,
    onValue: (String) -> Unit,
    onFocus: (Boolean) -> Unit,
    onCountry: () -> Unit,
    modifier: Modifier,
) {
    val box = modifier.fillMaxWidth().height(36.dp).testTag(id).then(reporting { lab.frame(f.tag, it) })
        .border(1.dp, BORDER, RoundedCornerShape(6.dp))
    if (f.kind == "country") {
        Row(box.clickable { onCountry() }.padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(value.ifEmpty { f.placeholder }, fontSize = 16.sp, modifier = Modifier.weight(1f))
            Text("▾", fontSize = 16.sp)
        }
        return
    }
    val keyboardType = when (f.kind) {
        "email" -> KeyboardType.Email
        "amount" -> KeyboardType.Decimal
        "pin" -> KeyboardType.NumberPassword
        else -> KeyboardType.Text
    }
    BasicTextField(
        value = value,
        onValueChange = onValue,
        singleLine = true,
        textStyle = TextStyle(fontSize = 16.sp),
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false, keyboardType = keyboardType),
        visualTransformation = if (f.kind == "pin") PasswordVisualTransformation() else VisualTransformation.None,
        modifier = box.focusRequester(requester).onFocusChanged { onFocus(it.isFocused) },
        decorationBox = { inner ->
            Box(Modifier.fillMaxSize().padding(horizontal = 8.dp), contentAlignment = Alignment.CenterStart) {
                if (value.isEmpty()) Text(f.placeholder, fontSize = 16.sp, color = Color.LightGray)
                inner()
            }
        },
    )
}

@Composable
private fun SubmitButton(cell: Cell, form: FormSpec, lab: Lab, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Button(onClick, modifier.fillMaxWidth().height(48.dp).testTag("lab.${cell.id}.${form.submitTag}").then(reporting { lab.frame(form.submitTag, it) })) {
        Text(form.submitTitle)
    }
}

/**
 * The country picker: a ModalBottomSheet fully expanded (the catalog's `sheet-large`) over a long lazy list — rows far
 * down are not laid out until scrolled to — a row's choice written back into the field and the sheet closed. A sheet
 * is a window of its own: RecordWindowTouches (Presented.kt) logs its touches.
 */
@Composable
private fun PickerSheet(cell: Cell, picker: PickerSpec, lab: Lab, onPick: (PickerRow) -> Unit, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        RecordWindowTouches(lab)
        Column(Modifier.fillMaxWidth().semantics { testTagsAsResourceId = true }.then(reporting { lab.frame("sheet", it) })) {
            Text(picker.title, fontSize = 17.sp, modifier = Modifier.align(Alignment.CenterHorizontally).padding(bottom = 8.dp))
            LazyColumn(Modifier.fillMaxWidth()) {
                items(picker.rows, key = { it.code }) { r ->
                    Text(
                        r.name,
                        fontSize = 17.sp,
                        modifier = Modifier.fillMaxWidth().height(52.dp).testTag("lab.${cell.id}.${picker.field}.${r.code}")
                            .then(reporting { lab.frame("row.${r.code}", it) })
                            .clickable { onPick(r) }.padding(horizontal = 20.dp, vertical = 14.dp),
                    )
                }
            }
        }
    }
}
