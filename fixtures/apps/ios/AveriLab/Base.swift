import SwiftUI

// The base family (fixtures/apps/cells/base.json): the coloured-target host every coloured-target cell is drawn on —
// four slots down the screen, each target a solid rectangle of its own colour reporting its frame. The `open` cell is
// this host alone; a presented cell raises its layer over it (Presented.swift#PresentedLayer, which also marks the
// state ready).

/// Where a slot's target is centred, in points from the screen's top-left: four rows down the screen, clear of the
/// status band (62 pt on the iPhone 17).
enum Slot {
    static let size = CGSize(width: 300, height: 64)
    static func centre(_ slot: Int, in screen: CGSize) -> CGPoint {
        CGPoint(x: screen.width / 2, y: 142 + CGFloat(slot) * 180)
    }
}

/// One target: a solid rectangle of its own colour, no visible text, its action logged; its frame reported in
/// screen coordinates (`.global` — the window fills the screen).
struct TargetView: View {
    @EnvironmentObject var lab: Lab
    let cell: Cell
    let target: Target

    var body: some View {
        Button {
            lab.event("tap", target.tag)
        } label: {
            Rectangle().fill(Color(hex: target.color))
        }
        .buttonStyle(Flat())
        .frame(width: Slot.size.width, height: Slot.size.height)
        .accessibilityIdentifier("lab.\(cell.id).\(target.tag)")
        .accessibilityLabel("Target \(target.tag)")
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { lab.frame(target.tag, $0) }
    }
}

/// No pressed highlight: a screenshot taken during a probe tap must still show the target's own colour.
struct Flat: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View { configuration.label }
}

/// The targets beneath the layer, each at its slot; the cell's layer (none for `open`) raised by PresentedLayer.
struct CellScreen: View {
    @EnvironmentObject var lab: Lab
    let cell: Cell

    var body: some View {
        GeometryReader { geo in
            let screen = CGSize(width: geo.size.width + geo.safeAreaInsets.leading + geo.safeAreaInsets.trailing,
                                height: geo.size.height + geo.safeAreaInsets.top + geo.safeAreaInsets.bottom)
            ZStack(alignment: .topLeading) {
                Color.white
                ForEach(cell.targets.filter { !$0.onLayer }, id: \.tag) { t in
                    TargetView(cell: cell, target: t).position(Slot.centre(t.slot, in: screen))
                }
            }
            .frame(width: screen.width, height: screen.height)
            .ignoresSafeArea()
        }
        .ignoresSafeArea()
        .modifier(PresentedLayer(cell: cell))
    }
}
