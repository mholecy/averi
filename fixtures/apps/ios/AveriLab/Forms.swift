import SwiftUI
import UIKit

// The forms family (fixtures/apps/cells/forms.json). A form cell (phase 1b of
// docs/plans/2026-10-15-ground-truth-lab-app.md): the fields of a payment form, a submit, maybe a country picker sheet
// — laid out as a banking app lays them out (a navigation bar, a scroll view, titles above the fields, errors under
// them), every one reporting to the oracle (Lab.swift#FieldState): the value the MODEL holds, the focus, the error it
// shows and the identifier it shows it under. A fill is judged by that, never by a tree.
//
// Nothing here transforms what is typed (no autocapitalisation, no autocorrection, no mask): a value that does not land
// as typed is averi's or idb's doing, not the app's — the one exception is iOS's own, a secure field that clears itself
// when typed into again after losing the focus.

struct FormScreen: View {
    @EnvironmentObject var lab: Lab
    let cell: Cell
    let form: FormSpec
    /// A scroll view shorter than the screen, pinned to the top (false-covers' toolbar-dismiss-short: calibration.json
    /// #7's second fix, mp-native's form scroll view 512 pt of 874); nil, the scroll view fills the screen.
    var scrollHeight: CGFloat? = nil
    @State private var values: [String: String] = [:]
    /// A submit has run: an invalid field shows its error from now on (and loses it once fixed).
    @State private var dirty = false
    @State private var picker = false
    @FocusState private var focus: String?
    /// The formatting field (FormattingTextField, a UIKit field) that has the focus: @FocusState cannot follow a
    /// UIViewRepresentable, so its delegate says so here.
    @State private var editing: String?
    /// The field the oracle is told has the focus: a SwiftUI field's, else a formatting field's.
    private var focused: String? { focus ?? editing }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ForEach(form.fields) { f in fieldRow(f) }
                    if form.submit.pinned != true { submitButton.padding(.top, 8) }
                    if dirty, !allValid, let e = form.screenError {
                        // A screen-level message, far under the last field: no field's error.
                        Text(e.text)
                            .font(.callout)
                            .foregroundStyle(.red)
                            .accessibilityIdentifier(e.id)
                            .reportFrame("screenError", to: lab)
                            .padding(.top, 40)
                    }
                }
                .padding(20)
            }
            .modifier(ShortScroll(height: scrollHeight))
            .safeAreaInset(edge: .bottom) {
                if form.submit.pinned == true {
                    // Its bar reported as `submit.bar`: what scripts/truth/truth.ts#situationOf reads as its cover.
                    submitButton.padding(.horizontal, 20).padding(.vertical, 10).background(.bar)
                        .reportFrame("\(form.submit.tag).bar", to: lab)
                }
            }
            .navigationTitle(form.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if let id = form.titleId {
                    // The title as an app draws its own (mp-native's SWIFT form): a principal item with an identifier,
                    // a tap on it ending the editing — the neutral element a keyboard dismissal taps.
                    ToolbarItem(placement: .principal) {
                        Text(form.title)
                            .font(.headline)
                            .accessibilityIdentifier(id)
                            .reportFrame("title", to: lab)
                            .onTapGesture { focus = nil }
                    }
                }
            }
        }
        .sheet(isPresented: $picker, onDismiss: { lab.event("dismissed", "sheet") }) {
            if let p = form.picker { PickerSheet(cell: cell, picker: p, value: binding(p.field), shown: $picker).environmentObject(lab) }
        }
        .onChange(of: dirty) { report() }
        .onChange(of: focus) {
            lab.focused(focused)
            report()
        }
        .onChange(of: editing) {
            lab.focused(focused)
            report()
        }
        .task {
            for f in form.fields { if let v = f.prefill { values[f.tag] = v } }
            report()
            // As an app raises them: after the screen has appeared. Ready once the keyboard or the sheet has had time
            // to finish animating in.
            try? await Task.sleep(for: .milliseconds(300))
            if form.submitOnAppear == true { submit() }
            if let f = form.focus { focus = f }
            if form.picker?.open == true { picker = true }
            let raised = form.focus != nil || form.picker?.open == true
            try? await Task.sleep(for: .milliseconds(raised ? 1500 : 500))
            lab.settled()
        }
    }

    private func fieldID(_ f: FieldSpec) -> String { f.fieldId ?? "lab.\(cell.id).\(f.tag)" }

    /// A field's value, reported to the oracle by the write itself: `.onChange(of: values)` missed the last keystroke of
    /// a fast burst (the HID typing of idb and WDA, one key per ~7 ms) — the @State held it, a submit read it, but no
    /// onChange followed, and the oracle kept the value one key short
    /// (docs/bugs/2026-10-15-lab-ios-swiftui-model-drops-trailing-typed-characters.md).
    /// A field with a `format` (form-format, D18) is a FormattingTextField: it formats each key before it writes here,
    /// so the model holds the formatted text in the same write (an `.onChange` would set it a write later — the burst
    /// trap above), and the screen shows it. Not a SwiftUI TextField whose setter formats: one that writes back a
    /// DIFFERENT string kept showing what was typed (D28, the owner's iOS run of D18).
    private func binding(_ tag: String) -> Binding<String> {
        Binding(get: { values[tag, default: ""] }, set: {
            values[tag] = $0
            report()
        })
    }

    @ViewBuilder private func fieldRow(_ f: FieldSpec) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if form.floatingTitles == true {
                // A design-system component (FE2): the title floats in the component's top, the input under it, the
                // two overlapping by a few points — the title reaches into the field's frame.
                ZStack(alignment: .topLeading) {
                    input(f)
                        .reportFrame(f.tag, to: lab)
                        .padding(.top, 10)
                    Text(f.title)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.leading, 8)
                        .allowsHitTesting(false)
                        .accessibilityIdentifier(f.titleId ?? "\(fieldID(f)).title")
                        .reportFrame("\(f.tag).title", to: lab)
                }
            } else {
                Text(f.title)
                    .font(.subheadline)
                    .accessibilityIdentifier(f.titleId ?? "\(fieldID(f)).title")
                    .reportFrame("\(f.tag).title", to: lab)
                input(f)
                    .reportFrame(f.tag, to: lab)
            }
            if let e = shownError(f) {
                Text(e.text)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .accessibilityIdentifier(e.id)
                    .reportFrame("\(f.tag).error", to: lab)
            }
        }
    }

    /// The field's input, under its identifier (fieldID) — a formatting field's set on its UITextField itself, so the tree
    /// holds one element by that identifier, the text field, as a SwiftUI field's does.
    /// A field that inserts on focus or refuses the keys (D64b) is a FormattingTextField too: its delegate puts the text
    /// in as the focus comes and refuses a key before the field changes — a SwiftUI TextField whose setter ignores a key
    /// may keep showing it (D28's trap), the screen and the model apart.
    @ViewBuilder private func input(_ f: FieldSpec) -> some View {
        let placeholder = f.placeholder ?? ""
        if f.format != nil || f.focusInsert != nil || f.keys == "refused", f.kind != "pin", f.kind != "country" {
            FormattingTextField(
                id: fieldID(f),
                placeholder: placeholder,
                format: f.format,
                keyboard: f.kind == "amount" ? .decimalPad : .default,
                focusInsert: f.focusInsert,
                refusesKeys: f.keys == "refused",
                text: binding(f.tag)
            ) { on in
                if on { editing = f.tag } else if editing == f.tag { editing = nil }
            }
            .frame(maxWidth: .infinity, minHeight: 34)
        } else {
            plainInput(f, placeholder).accessibilityIdentifier(fieldID(f))
        }
    }

    @ViewBuilder private func plainInput(_ f: FieldSpec, _ placeholder: String) -> some View {
        switch f.kind {
        case "pin":
            SecureField(placeholder, text: binding(f.tag))
                .keyboardType(.numberPad)
                .textFieldStyle(.roundedBorder)
                .focused($focus, equals: f.tag)
        case "country":
            Button {
                lab.event("tap", f.tag)
                picker = true
            } label: {
                HStack {
                    Text(values[f.tag].map { $0.isEmpty ? placeholder : $0 } ?? placeholder)
                    Spacer()
                    Image(systemName: "chevron.down")
                }
                .padding(.horizontal, 8)
                .frame(height: 34)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(.quaternary))
        default:
            TextField(placeholder, text: binding(f.tag))
                .keyboardType(f.kind == "email" ? .emailAddress : f.kind == "amount" ? .decimalPad : .default)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)
                .focused($focus, equals: f.tag)
        }
    }

    private var submitButton: some View {
        Button {
            submit()
        } label: {
            Text(form.submit.title).frame(maxWidth: .infinity).padding(.vertical, 6)
        }
        .buttonStyle(.borderedProminent)
        .accessibilityIdentifier("lab.\(cell.id).\(form.submit.tag)")
        .reportFrame(form.submit.tag, to: lab)
    }

    // --- validation: a banking form's, small and transparent ---

    private func invalid(_ f: FieldSpec) -> Bool {
        let v = values[f.tag, default: ""].trimmingCharacters(in: .whitespaces)
        switch f.kind {
        case "email": return !(v.contains("@") && v.contains("."))
        case "iban":
            let compact = v.replacingOccurrences(of: " ", with: "")
            return compact.count < 15 || !compact.prefix(2).allSatisfy(\.isLetter)
        case "amount":
            let n = Double(v.replacingOccurrences(of: "\u{00A0}", with: "").replacingOccurrences(of: " ", with: "").replacingOccurrences(of: ",", with: "."))
            return n == nil || n! <= 0 || n! > 10_000
        case "pin": return v.count != 4 || !v.allSatisfy(\.isNumber)
        default: return v.isEmpty
        }
    }

    private var allValid: Bool { form.fields.allSatisfy { !invalid($0) } }

    private func shownError(_ f: FieldSpec) -> Message? {
        guard dirty, invalid(f) else { return nil }
        return f.error ?? Message(text: "Required", id: "\(fieldID(f))_error")
    }

    private func submit() {
        dirty = true
        lab.submit(valid: allValid, values: values)
    }

    private func report() {
        for f in form.fields {
            lab.field(f.tag, FieldState(value: values[f.tag, default: ""], focused: focused == f.tag, error: shownError(f)))
        }
    }
}

/// A text field that formats as it is typed — on the screen and in the model alike (D28). The owner's iOS run of D18
/// (2026-10-31, iPhone 17, iOS 27) found a SwiftUI TextField whose binding setter writes back a DIFFERENT string keeps
/// showing what was typed: f1–f3 read `SK3112000000` on the screen while the model held `SK31 1200 0000`. UIKit's
/// delegate sees every key, one at a time, BEFORE the field changes (the HID typing of idb and WDA, a key per ~7 ms,
/// included): the edit is applied to the field's text, formatted, shown, the caret put at the end, and written to the
/// model in that one call — a burst cannot leave the screen and the model a key apart (the trap `binding` names), and
/// the field reformats as a banking app's IBAN field does, the caret staying at the end for the next key.
/// Not followed: FormScreen's @FocusState (a programmatic `form.focus`, a title tap's `focus = nil`) — no formatting
/// cell uses either.
struct FormattingTextField: UIViewRepresentable {
    let id: String
    let placeholder: String
    let format: String?
    let keyboard: UIKeyboardType
    /// D64b: put in on focus while the field is empty, the caret after it (a dial code, `+421 `).
    var focusInsert: String? = nil
    /// D64b: every key refused — the field changes only from outside (a focusInsert, a prefill).
    var refusesKeys = false
    @Binding var text: String
    /// The field took (true) or lost (false) the focus.
    let editing: (Bool) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> UITextField {
        let field = UITextField()
        field.accessibilityIdentifier = id
        field.placeholder = placeholder
        field.borderStyle = .roundedRect
        field.keyboardType = keyboard
        field.autocorrectionType = .no
        field.autocapitalizationType = .none
        field.spellCheckingType = .no
        field.smartQuotesType = .no
        field.smartDashesType = .no
        field.smartInsertDeleteType = .no
        field.text = text
        field.delegate = context.coordinator
        field.setContentHuggingPriority(.defaultLow, for: .horizontal)
        field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return field
    }

    func updateUIView(_ field: UITextField, context: Context) {
        context.coordinator.parent = self
        // A change from outside (a prefill) is shown; the field's own writes come back equal and move nothing — the caret
        // stays where the delegate put it.
        if field.text != text { field.text = text }
    }

    final class Coordinator: NSObject, UITextFieldDelegate {
        var parent: FormattingTextField
        init(_ parent: FormattingTextField) { self.parent = parent }

        func textField(_ field: UITextField, shouldChangeCharactersIn range: NSRange, replacementString string: String) -> Bool {
            if parent.refusesKeys { return false }
            let edited = ((field.text ?? "") as NSString).replacingCharacters(in: range, with: string)
            let shown = formatted(parent.format, edited)
            field.text = shown
            let end = field.endOfDocument
            field.selectedTextRange = field.textRange(from: end, to: end)
            parent.text = shown
            // The field was set here; UIKit must not apply the edit a second time.
            return false
        }

        func textFieldDidBeginEditing(_ field: UITextField) {
            if let insert = parent.focusInsert, (field.text ?? "").isEmpty {
                field.text = insert
                let end = field.endOfDocument
                field.selectedTextRange = field.textRange(from: end, to: end)
                parent.text = insert
            }
            parent.editing(true)
        }
        func textFieldDidEndEditing(_ field: UITextField) { parent.editing(false) }

        func textFieldShouldReturn(_ field: UITextField) -> Bool {
            field.resignFirstResponder()
            return true
        }
    }
}

/// The country picker: a long lazy list (rows far down are not laid out until scrolled to), a row's choice written back
/// into the field and the sheet closed.
struct PickerSheet: View {
    @EnvironmentObject var lab: Lab
    let cell: Cell
    let picker: PickerSpec
    @Binding var value: String
    @Binding var shown: Bool

    var body: some View {
        NavigationStack {
            List(picker.rows) { r in
                Button {
                    value = r.name
                    lab.event("select", r.code)
                    shown = false
                } label: {
                    Text(r.name).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("lab.\(cell.id).\(picker.field).\(r.code)")
                .reportFrame("row.\(r.code)", to: lab)
            }
            .listStyle(.plain)
            .navigationTitle(picker.title)
            .navigationBarTitleDisplayMode(.inline)
        }
        .reportFrame("sheet", to: lab)
    }
}

extension View {
    /// The view's frame in screen coordinates (`.global`: the window fills the screen, a sheet is in the same window).
    func reportFrame(_ tag: String, to lab: Lab) -> some View {
        onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { lab.frame(tag, $0) }
    }
}

/// FormScreen's scroll view `height` tall at the top of the screen, when given.
private struct ShortScroll: ViewModifier {
    let height: CGFloat?

    func body(content: Content) -> some View {
        if let height {
            content.frame(height: height).frame(maxHeight: .infinity, alignment: .top)
        } else {
            content
        }
    }
}

// --- the formats (scripts/truth/schema.ts#FieldFormat, D18; the same rules as Forms.kt's and the React Native app's
// src/format.ts) ---

private func isGap(_ c: Character) -> Bool { c == " " || c == "\u{00A0}" || c == "\u{202F}" }

private func groups(_ s: String, _ n: Int) -> [String] {
    var out: [String] = []
    var rest = Substring(s)
    while !rest.isEmpty {
        out.append(String(rest.prefix(n)))
        rest = rest.dropFirst(n)
    }
    return out
}

/// group4eager's longest text, its spaces aside (an IBAN's 24 characters).
private let eagerMax = 24

/// `group4`: whitespace dropped, groups of four joined by a space; `thousands`: the whole part before the first `,` or
/// `.` grouped in threes from the right by a no-break space, the rest kept; `date` a dotted date; `group4eager` (L7)
/// `group4` on the first 24 characters, a space after a complete group while under 24; `phone3` (L7) a leading `+`
/// kept, the digits alone in threes (schema.ts#FieldFormat). The table tests/truth/lab-format.test.ts pins on the React
/// Native app's src/format.ts, which this spells too: group4eager `SK31` → `SK31 `, `SK3112000000` →
/// `SK31 1200 0000 `, `SK3112000000123` → `SK31 1200 0000 123`, 24 characters → six groups and no space; phone3
/// `421903123456` → `421 903 123 456`, `+421903123456` and `+421 903 123 456` → `+421 903 123 456`, `+4219` → `+421 9`.
func formatted(_ format: String?, _ text: String) -> String {
    switch format {
    case "group4":
        return groups(text.filter { !isGap($0) }, 4).joined(separator: " ")
    case "thousands":
        let cut = text.firstIndex { $0 == "," || $0 == "." } ?? text.endIndex
        let whole = String(text[..<cut].filter { !isGap($0) })
        return groups(String(whole.reversed()), 3).map { String($0.reversed()) }.reversed().joined(separator: "\u{00A0}") + text[cut...]
    case "date":
        let digits = text.filter { $0.isASCII && $0.isNumber }.prefix(8)
        return [String(digits.prefix(2)), String(digits.dropFirst(2).prefix(2)), String(digits.dropFirst(4))].filter { !$0.isEmpty }.joined(separator: ".")
    case "group4eager":
        let kept = String(text.filter { !isGap($0) }.prefix(eagerMax))
        let eager = !kept.isEmpty && kept.count % 4 == 0 && kept.count < eagerMax
        return groups(kept, 4).joined(separator: " ") + (eager ? " " : "")
    case "phone3":
        let plus = text.drop(while: isGap).first == "+"
        return (plus ? "+" : "") + groups(String(text.filter { $0.isASCII && $0.isNumber }), 3).joined(separator: " ")
    default:
        return text
    }
}
