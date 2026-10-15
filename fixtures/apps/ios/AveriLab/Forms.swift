import SwiftUI

// The forms family (fixtures/apps/cells/forms.json). A form cell (phase 1b of
// docs/plans/2026-10-15-ground-truth-lab-app.md): the fields of a payment form, a submit, maybe a country picker sheet —
// laid out as a banking app lays them out (a navigation bar, a scroll view, titles above
// the fields, errors under them), every one reporting to the oracle (Lab.swift#FieldState): the value the MODEL holds,
// the focus, the error it shows and the identifier it shows it under. A fill is judged by that, never by a tree.
//
// Nothing here transforms what is typed (no autocapitalisation, no autocorrection, no mask): a value that does not land
// as typed is averi's or idb's doing, not the app's — the one exception is iOS's own, a secure field that clears itself
// when typed into again after losing the focus.

struct FormScreen: View {
    @EnvironmentObject var lab: Lab
    let cell: Cell
    let form: FormSpec
    @State private var values: [String: String] = [:]
    /// A submit has run: an invalid field shows its error from now on (and loses it once fixed).
    @State private var dirty = false
    @State private var picker = false
    @FocusState private var focus: String?

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
            .safeAreaInset(edge: .bottom) {
                if form.submit.pinned == true {
                    submitButton.padding(.horizontal, 20).padding(.vertical, 10).background(.bar)
                }
            }
            .navigationTitle(form.title)
            .navigationBarTitleDisplayMode(.inline)
        }
        .sheet(isPresented: $picker, onDismiss: { lab.event("dismissed", "sheet") }) {
            if let p = form.picker { PickerSheet(cell: cell, picker: p, value: binding(p.field), shown: $picker).environmentObject(lab) }
        }
        .onChange(of: values) { report() }
        .onChange(of: dirty) { report() }
        .onChange(of: focus) {
            lab.focused(focus)
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

    private func fieldID(_ f: FieldSpec) -> String { "lab.\(cell.id).\(f.tag)" }

    private func binding(_ tag: String) -> Binding<String> {
        Binding(get: { values[tag, default: ""] }, set: { values[tag] = $0 })
    }

    @ViewBuilder private func fieldRow(_ f: FieldSpec) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(f.title)
                .font(.subheadline)
                .accessibilityIdentifier(f.titleId ?? "\(fieldID(f)).title")
                .reportFrame("\(f.tag).title", to: lab)
            input(f)
                .accessibilityIdentifier(fieldID(f))
                .reportFrame(f.tag, to: lab)
            if let e = shownError(f) {
                Text(e.text)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .accessibilityIdentifier(e.id)
                    .reportFrame("\(f.tag).error", to: lab)
            }
        }
    }

    @ViewBuilder private func input(_ f: FieldSpec) -> some View {
        let placeholder = f.placeholder ?? ""
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
            lab.field(f.tag, FieldState(value: values[f.tag, default: ""], focused: focus == f.tag, error: shownError(f)))
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
