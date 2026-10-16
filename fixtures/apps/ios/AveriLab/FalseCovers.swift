import SwiftUI
import UIKit

// The false-covers family (fixtures/apps/cells/false-covers.json): what lies over a target in a tree yet is no cover.
//
// - `own-parts`: text targets (CatalogTarget.text) drawn on their own control — `L` a button's own label (Android's
//   Compose button lists its text before an unlabelled button of its size: calibration.json #8), `N` a text field's
//   own floating label, the empty field laid over it, its rect a point inside the label's (the field's own scroll
//   indicator under WDA: #18). A tap on either text fires its control: logged as the target's `tap`.
// - `toolbar-dismiss` (layer `toolbar-screen`) and `toolbar-dismiss-bar` (`toolbar-bar`): a form (Forms.swift's
//   FormScreen, its principal title the cell's `keyboardDismiss` taps) with a UIKit toolbar laid over the screen after
//   it — screen-sized (#7: SwiftUI's full-screen `Toolbar` host) or over the navigation bar (#19: an itemless bar).
//   The toolbar draws nothing and takes no touch: a tap on the title still ends the editing (FormTruth.title).

struct FalseCoversScreen: View {
    let cell: Cell

    var body: some View {
        if let form = cell.form {
            FormScreen(cell: cell, form: form).overlay(alignment: .top) { ShadowToolbar(layer: cell.layer) }
        } else {
            OwnPartsScreen(cell: cell)
        }
    }
}

/// A UIToolbar with no items, clear and passing every touch through, laid after the form in the accessibility order
/// — what WDA lists as a `Toolbar` over the title. `toolbar-screen`: the whole screen; `toolbar-bar`: the navigation
/// bar's band (the status band's bottom, 54 pt).
struct ShadowToolbar: View {
    let layer: String

    var body: some View {
        GeometryReader { geo in
            let top = geo.safeAreaInsets.top
            ToolbarHost()
                .frame(width: geo.size.width, height: layer == "toolbar-screen" ? geo.size.height + top + geo.safeAreaInsets.bottom : 54)
                .offset(y: layer == "toolbar-screen" ? -top : 0)
        }
        .allowsHitTesting(false)
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
    @State private var value = ""
    @FocusState private var focused: Bool

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
                        .frame(height: 22)
                        .padding(.leading, 18)
                        .allowsHitTesting(false)
                        .accessibilityIdentifier(id)
                        .reportFrame(target.tag, to: lab)
                    TextField("", text: $value)
                        .frame(height: 20)
                        .padding(.horizontal, 18)
                        .focused($focused)
                        .accessibilityIdentifier("\(id).field")
                }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("\(id).box")
                .onChange(of: focused) { if focused { lab.event("tap", target.tag) } }
            }
        }
        .frame(width: Slot.size.width, height: Slot.size.height)
        .reportFrame("\(target.tag).box", to: lab)
    }
}
