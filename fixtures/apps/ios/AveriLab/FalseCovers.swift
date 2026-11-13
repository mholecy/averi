import SwiftUI
import UIKit

// The false-covers family (fixtures/apps/cells/false-covers.json): what lies over a target in a tree yet is no cover.
//
// - `own-parts`: text targets (CatalogTarget.text) drawn on their own control — `L` a button's own label (Android's
//   Compose button lists its text before an unlabelled button of its size: calibration.json #8), `N` a text field's
//   own label, an empty UIKit field 14 pt tall laid over it and after it in the accessibility order, the label's text
//   reaching past the field at the top and the bottom (#18's text-field half: the field over its own label). A tap
//   on either text fires its control: logged as the target's `tap`. `I`, a label target (CatalogTarget.label): an
//   icon button (44 pt, a white glyph) labelled by its accessibility label on a box of its colour — Android's
//   IconButton lists its icon, labelled, before an unlabelled clickable inset on all four sides (#8's second fix).
//   SwiftUI lists the button alone, labelled Close, under WDA and idb alike (captured 2026-10-18, iOS 27.0). A tap on
//   it fires the button.
// - `toolbar-dismiss` (layer `toolbar-screen`) and `toolbar-dismiss-bar` (`toolbar-bar`): a form (Forms.swift's
//   FormScreen, its principal title the cell's `keyboardDismiss` taps). The principal item makes SwiftUI lay its own
//   full-screen `Toolbar` host (one empty child) after the content in WDA's tree — #7's shape, on both cells;
//   `toolbar-bar` adds an itemless UIKit toolbar over the navigation bar (#19); `toolbar-dismiss-short` (layer
//   `toolbar-screen-short`) is toolbar-dismiss with the form's scroll view 451 pt tall below the bar (FormScreen's
//   scrollHeight): no host by size — WDA lists it 0,0 402x567, its frame running up under the bar over the title, its
//   rows below it, its foot 6 pt above the keyboard's top so no field lies clipped above the keyboard (touching it,
//   SwiftUI runs the scroll view on under the keyboard to the screen's foot: measured 0,0 402x874) — #7's second fix,
//   c3ebc62; mp-native's 0,0 402x512. No toolbar draws anything or takes a touch: a tap on the title still ends the
//   editing (FormTruth.title).
// - `tap-catcher-beneath` (ADR 0018 residual 9's false-positive probe, round 16): the four slot targets in a
//   screen-sized accessibility container, a screen-wide `.accessibilityHidden` tap-to-dismiss background drawn BENEATH
//   it (`.background`, the common "tap outside to end editing" shape) — the blur menu's backdrop's shape in the tree,
//   but under the content, not over it; `tap-catcher-stacked` the same, the tap-catcher declared first in a ZStack
//   with the content. A touch on it logs `dismissed background`; a tap on a target fires it.
// - `tap-catcher-beneath-flat` (backlog A43): the same catcher beneath the four targets laid UNGROUPED, its siblings —
//   the ungrouped blur-menu's run with the catcher drawn under the targets. Why, what it predicts and what its capture
//   settles: ADR 0018, the A43 amendment.

struct FalseCoversScreen: View {
    let cell: Cell

    var body: some View {
        if TapCatcherScreen.layers.contains(cell.layer) {
            TapCatcherScreen(cell: cell)
        } else if let form = cell.form {
            FormScreen(cell: cell, form: form, scrollHeight: cell.layer == "toolbar-screen-short" ? 451 : nil).overlay(alignment: .top) { if cell.layer == "toolbar-bar" { ShadowToolbar() } }
        } else {
            OwnPartsScreen(cell: cell)
        }
    }
}

/// `tap-catcher-beneath` and `tap-catcher-stacked`: the slot targets, grouped, over a hidden screen-wide tap-catcher;
/// `tap-catcher-beneath-flat` the targets ungrouped (see the file's head). A layer it does not build shows an
/// UnbuiltCell, never ready.
struct TapCatcherScreen: View {
    @EnvironmentObject var lab: Lab
    let cell: Cell

    /// The layers this screen builds; FalseCoversScreen routes these alone here.
    static let layers: Set<String> = ["tap-catcher-beneath", "tap-catcher-stacked", "tap-catcher-beneath-flat"]

    var body: some View {
        GeometryReader { geo in
            let screen = CGSize(width: geo.size.width + geo.safeAreaInsets.leading + geo.safeAreaInsets.trailing,
                                height: geo.size.height + geo.safeAreaInsets.top + geo.safeAreaInsets.bottom)
            Group {
                switch cell.layer {
                case "tap-catcher-beneath":
                    content(screen, grouped: true).background { catcher }
                case "tap-catcher-stacked":
                    ZStack(alignment: .topLeading) {
                        catcher
                        content(screen, grouped: true)
                    }
                case "tap-catcher-beneath-flat":
                    // The catcher declared before the targets, as blur-menu's backdrop is; zIndex draws it under them.
                    ZStack(alignment: .topLeading) {
                        catcher.zIndex(0)
                        content(screen, grouped: false).zIndex(1)
                    }
                default:
                    UnbuiltCell(cell: cell)
                }
            }
            .frame(width: screen.width, height: screen.height)
            .ignoresSafeArea()
        }
        .ignoresSafeArea()
        .task {
            guard Self.layers.contains(cell.layer) else { return }
            try? await Task.sleep(for: .milliseconds(600))
            lab.settled()
        }
    }

    /// The screen's content: a fill passing every touch through (so the content's container lies at 0,0 the screen's
    /// size, as the tap-catcher does — WDA lists the two at the same top) and the targets; `grouped`, one
    /// accessibility container of them, else none (the targets ungrouped).
    private func content(_ screen: CGSize, grouped: Bool) -> some View {
        ZStack(alignment: .topLeading) {
            Color(white: 0.98).allowsHitTesting(false)
            ForEach(cell.targets, id: \.tag) { t in
                TargetView(cell: cell, target: t).position(Slot.centre(t.slot, in: screen))
            }
        }
        .frame(width: screen.width, height: screen.height)
        .modifier(Grouped(on: grouped))
    }

    /// The hidden tap-to-dismiss background.
    private var catcher: some View {
        Color.white
            .contentShape(Rectangle())
            .onTapGesture { lab.event("dismissed", "background") }
            .accessibilityHidden(true)
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

/// One text target on its control: `L` a button whose label is the text; any other a text field's label with the empty
/// field over it (in WDA's tree the label 18 pt tall, the field 14, both centred: the label's rect 2 pt past the
/// field's at the top and the bottom — on mp-native's SWIFT form the label reached 1 pt past its field).
struct OwnPart: View {
    @EnvironmentObject var lab: Lab
    let cell: Cell
    let target: Target

    private var id: String { "lab.\(cell.id).\(target.tag)" }

    var body: some View {
        Group {
            if let label = target.label {
                ZStack {
                    Rectangle().fill(Color(hex: target.color))
                    Button {
                        lab.event("tap", target.tag)
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(width: 44, height: 44)
                            .background(Color(hex: target.color))
                    }
                    .buttonStyle(Flat())
                    .accessibilityLabel(label)
                    .accessibilityIdentifier(id)
                    .reportFrame(target.tag, to: lab)
                }
            } else if target.tag == "L" {
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
