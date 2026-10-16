import SwiftUI
import UIKit

// The false-covers family (fixtures/apps/cells/false-covers.json): what lies over a target in a tree yet is no cover.
//
// - `own-parts`: text targets (CatalogTarget.text) drawn on their own control — `L` a button's own label (Android's
//   Compose button lists its text before an unlabelled button of its size: calibration.json #8), `N` a text field's
//   own label, an empty UIKit field 14 pt tall laid over it and after it in the accessibility order, the label's text
//   reaching past the field at the top and the bottom (#18's text-field half: the field over its own label). A tap
//   on either text fires its control: logged as the target's `tap`.
// - `toolbar-dismiss` (layer `toolbar-screen`) and `toolbar-dismiss-bar` (`toolbar-bar`): a form (Forms.swift's
//   FormScreen, its principal title the cell's `keyboardDismiss` taps). The principal item makes SwiftUI lay its own
//   full-screen `Toolbar` host (one empty child) after the content in WDA's tree — #7's shape, on both cells;
//   `toolbar-bar` adds an itemless UIKit toolbar over the navigation bar (#19). Neither draws anything or takes a
//   touch: a tap on the title still ends the editing (FormTruth.title).

struct FalseCoversScreen: View {
    let cell: Cell

    var body: some View {
        if let form = cell.form {
            FormScreen(cell: cell, form: form).overlay(alignment: .top) { if cell.layer == "toolbar-bar" { ShadowToolbar() } }
        } else {
            OwnPartsScreen(cell: cell)
        }
    }
}

/// `toolbar-bar`'s UIToolbar: no items, clear and passing every touch through, laid after the form in the
/// accessibility order at the navigation bar's top — WDA lists it as a 402×48 `Toolbar` with one empty child over the
/// title (measured 0,65 402x48 on the iPhone 17, the title at 138,73 126x22).
struct ShadowToolbar: View {
    var body: some View {
        ToolbarHost().frame(height: 54).allowsHitTesting(false)
    }
}

struct ToolbarHost: UIViewRepresentable {
    func makeUIView(context: Context) -> UIToolbar {
        let bar = UIToolbar()
        bar.items = []
        bar.isUserInteractionEnabled = false
        bar.setBackgroundImage(UIImage(), forToolbarPosition: .any, barMetrics: .default)
        bar.setShadowImage(UIImage(), forToolbarPosition: .any)
        bar.backgroundColor = .clear
        bar.isTranslucent = true
        return bar
    }

    func updateUIView(_ bar: UIToolbar, context: Context) {}
}

/// The own-parts cell: each text target at its slot, on its control.
struct OwnPartsScreen: View {
    @EnvironmentObject var lab: Lab
    let cell: Cell

    var body: some View {
        GeometryReader { geo in
            let screen = CGSize(width: geo.size.width + geo.safeAreaInsets.leading + geo.safeAreaInsets.trailing,
                                height: geo.size.height + geo.safeAreaInsets.top + geo.safeAreaInsets.bottom)
            ZStack(alignment: .topLeading) {
                Color.white
                ForEach(cell.targets, id: \.tag) { t in
                    OwnPart(cell: cell, target: t).position(Slot.centre(t.slot, in: screen))
                }
            }
            .frame(width: screen.width, height: screen.height)
            .ignoresSafeArea()
        }
        .ignoresSafeArea()
        .task {
            try? await Task.sleep(for: .milliseconds(600))
            lab.settled()
        }
    }
}

/// One text target on its control: `L` a button whose label is the text; any other a text field's floating label with
/// the empty field over it (the label 22 pt tall, the field 20, both centred: the label's rect a point past the
/// field's at the top and the bottom, as on mp-native's SWIFT form).
struct OwnPart: View {
    @EnvironmentObject var lab: Lab
    let cell: Cell
    let target: Target

    private var id: String { "lab.\(cell.id).\(target.tag)" }

    var body: some View {
        Group {
            if target.tag == "L" {
                Button {
                    lab.event("tap", target.tag)
                } label: {
                    ZStack {
                        Rectangle().fill(Color(hex: target.color))
                        Text(target.text ?? "")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(.white)
                            .accessibilityIdentifier(id)
                            .reportFrame(target.tag, to: lab)
                    }
                }
                .buttonStyle(Flat())
                .accessibilityIdentifier("\(id).box")
            } else {
                ZStack(alignment: .leading) {
                    Rectangle().fill(Color(hex: target.color))
                    Text(target.text ?? "")
                        .font(.system(size: 15))
                        .padding(.leading, 18)
                        .allowsHitTesting(false)
                        .accessibilityIdentifier(id)
                        .accessibilitySortPriority(1)
                        .reportFrame(target.tag, to: lab)
                    // A UIKit text field, 14 pt tall: the label's text (18 pt) reaches past it at the top and the
                    // bottom, and the field comes after the label in the accessibility order.
                    LabTextField(id: "\(id).field") { lab.event("tap", target.tag) }
                        .frame(height: 14)
                        .padding(.horizontal, 18)
                }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("\(id).box")
            }
        }
        .frame(width: Slot.size.width, height: Slot.size.height)
        .reportFrame("\(target.tag).box", to: lab)
    }
}

/// An empty UITextField that logs when it takes the focus.
struct LabTextField: UIViewRepresentable {
    let id: String
    let focused: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(focused: focused) }

    func makeUIView(context: Context) -> UITextField {
        let field = UITextField()
        field.accessibilityIdentifier = id
        field.autocorrectionType = .no
        field.autocapitalizationType = .none
        field.delegate = context.coordinator
        field.setContentHuggingPriority(.defaultLow, for: .vertical)
        field.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
        return field
    }

    func updateUIView(_ field: UITextField, context: Context) {}

    final class Coordinator: NSObject, UITextFieldDelegate {
        let focused: () -> Void
        init(focused: @escaping () -> Void) { self.focused = focused }
        func textFieldDidBeginEditing(_ textField: UITextField) { focused() }
    }
}
