import SwiftUI
import UIKit

// The bars family (fixtures/apps/cells/bars.json): the system bands and the app's chrome over coloured targets — the
// status and home-indicator bands (`bands`), a pinned bottom button over a target's edge (`pinned-bar`), a floating tab
// bar whose surface reaches above its items (`tabbar-floating`), a screen pushed over a tab host that hides its tab bar
// (`tabbar-hidden-push`, WDA's phantom tab bar), a transparent host holding a FAB (`fab`). Each cell reports what its
// geometry is measured from (scripts/truth/truth.ts#geometryOf): the window's safe-area insets, its scroll view's clip,
// its chrome's frames. The pieces are Base.swift's (Flat); a target here takes the size its cell gives it.

struct BarsScreen: View {
    @EnvironmentObject var lab: Lab
    let cell: Cell

    var body: some View {
        switch cell.id {
        case "tabbar-hidden-push": HiddenTabPush(cell: cell)
        case "bands", "pinned-bar", "tabbar-floating", "fab": BarsHost(cell: cell)
        default: UnbuiltCell(cell: cell)
        }
    }
}

/// The tab bar's and the pinned button's colours: none of them a target's.
private let chromeColour = Color(hex: "#263238")
private let chromeItem = Color(hex: "#546E7A")
private let fabColour = Color(hex: "#00897B")

/// The key window's safe-area insets (the status band on top, the home indicator's at the bottom).
@MainActor private func windowInsets() -> UIEdgeInsets {
    UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first?.keyWindow?.safeAreaInsets ?? .zero
}

/// One target of a bars cell: TargetView (Base.swift) at the size its cell gives it, its frame reported in screen
/// coordinates — unclipped, so a row far down a scroll view keeps its whole frame.
struct BarTarget: View {
    @EnvironmentObject var lab: Lab
    let cell: Cell
    let tag: String
    let size: CGSize

    var body: some View {
        if let target = cell.targets.first(where: { $0.tag == tag }) {
            Button {
                lab.event("tap", target.tag)
            } label: {
                Rectangle().fill(Color(hex: target.color))
            }
            .buttonStyle(Flat())
            .frame(width: size.width, height: size.height)
            .accessibilityIdentifier("lab.\(cell.id).\(target.tag)")
            .accessibilityLabel("Target \(target.tag)")
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { lab.frame(target.tag, $0) }
        }
    }
}

/// The screen of the four drawn cells: white, edge to edge (the window fills the screen), laid out once the window's
/// insets are known; the insets reported, then ready.
struct BarsHost: View {
    @EnvironmentObject var lab: Lab
    let cell: Cell
    @State private var insets: UIEdgeInsets?

    var body: some View {
        let screen = UIScreen.main.bounds.size
        ZStack(alignment: .topLeading) {
            Color.white
            if let insets {
                switch cell.id {
                case "bands": Bands(cell: cell, screen: screen, insets: insets)
                case "pinned-bar": PinnedBar(cell: cell, screen: screen, insets: insets)
                case "tabbar-floating": TabbarFloating(cell: cell, screen: screen, insets: insets)
                default: FabCell(cell: cell, screen: screen, insets: insets)
                }
            }
        }
        .frame(width: screen.width, height: screen.height)
        .ignoresSafeArea()
        .task {
            try? await Task.sleep(for: .milliseconds(300))
            let i = windowInsets()
            insets = i
            lab.safeArea()
            try? await Task.sleep(for: .milliseconds(800))
            lab.settled()
        }
    }
}

private let slot = CGSize(width: 300, height: 64)

/// `bands`: S centred in the status band, O its top edge 4 pt into it (centre clear), W in the open, Q its bottom edge
/// 4 pt into the home indicator's band (centre clear), N centred in that band (calibration.json #21, #22, #23).
struct Bands: View {
    let cell: Cell
    let screen: CGSize
    let insets: UIEdgeInsets

    var body: some View {
        let x = screen.width / 2
        let thin = CGSize(width: slot.width, height: 20)
        BarTarget(cell: cell, tag: "S", size: thin).position(x: x, y: insets.top / 2)
        BarTarget(cell: cell, tag: "O", size: slot).position(x: x, y: insets.top - 4 + slot.height / 2)
        BarTarget(cell: cell, tag: "W", size: slot).position(x: x, y: screen.height / 2)
        BarTarget(cell: cell, tag: "Q", size: slot).position(x: x, y: screen.height - insets.bottom + 4 - slot.height / 2)
        BarTarget(cell: cell, tag: "N", size: thin).position(x: x, y: screen.height - insets.bottom / 2)
    }
}

/// `pinned-bar`: a button pinned 16 pt above the home indicator's band (chrome `pinned`), over P's bottom 24 pt (P's
/// centre clear); W in the open (calibration.json #22, the pinned CONTINUE).
struct PinnedBar: View {
    @EnvironmentObject var lab: Lab
    let cell: Cell
    let screen: CGSize
    let insets: UIEdgeInsets

    var body: some View {
        let x = screen.width / 2
        let buttonTop = screen.height - insets.bottom - 16 - 56
        BarTarget(cell: cell, tag: "W", size: slot).position(x: x, y: screen.height / 2 - 120)
        BarTarget(cell: cell, tag: "P", size: slot).position(x: x, y: buttonTop + 24 - slot.height / 2)
        Button {
            lab.event("button", "pinned.continue")
        } label: {
            RoundedRectangle(cornerRadius: 12).fill(chromeColour)
                .overlay(Text("Continue").foregroundStyle(.white))
        }
        .buttonStyle(Flat())
        .frame(width: screen.width - 48, height: 56)
        .accessibilityIdentifier("lab.\(cell.id).continue")
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { lab.chrome("pinned", $0) }
        .position(x: x, y: buttonTop + 28)
    }
}

/// `tabbar-floating`: a 200-pt header, then a scroll view (`list`) down to the home indicator's band, under a floating
/// tab bar — a pill (chrome `tabBar`) 44 pt above the screen's bottom, its four items 12 pt below its top edge; the
/// pill's surface takes a tap (`button tabBar.surface`) and is no accessibility element (as the measured app's: no node
/// has its rect), an item logs `tab <name>`. T lies in the open; R at 24,721 354x52 on the iPhone 17, its centre in the
/// strip of the pill above its items (calibration.json #14); F far below the fold (#11's neighbour).
struct TabbarFloating: View {
    @EnvironmentObject var lab: Lab
    let cell: Cell
    let screen: CGSize
    let insets: UIEdgeInsets

    var body: some View {
        let header: CGFloat = 200
        let pillTop = screen.height - 44 - 87
        let row = CGSize(width: screen.width - 48, height: 52)
        let x = screen.width / 2
        Text("Header").position(x: x, y: header / 2)
        ScrollView {
            ZStack(alignment: .topLeading) {
                Color.white.frame(width: screen.width, height: 2400)
                BarTarget(cell: cell, tag: "T", size: row).position(x: x, y: 100 + row.height / 2)
                BarTarget(cell: cell, tag: "R", size: row).position(x: x, y: pillTop + 4 - header)
                BarTarget(cell: cell, tag: "F", size: row).position(x: x, y: 2000 + row.height / 2)
            }
            .frame(width: screen.width, height: 2400)
        }
        .frame(width: screen.width, height: screen.height - header - insets.bottom)
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { lab.scrollView("list", $0) }
        .position(x: x, y: header + (screen.height - header - insets.bottom) / 2)
        ZStack(alignment: .top) {
            RoundedRectangle(cornerRadius: 32).fill(chromeColour)
                .contentShape(Rectangle())
                .onTapGesture { lab.event("button", "tabBar.surface") }
                .accessibilityHidden(true)
            HStack(spacing: 0) {
                ForEach(["home", "transactions", "cards", "more"], id: \.self) { name in
                    Button {
                        lab.event("tab", name)
                    } label: {
                        RoundedRectangle(cornerRadius: 16).fill(chromeItem)
                    }
                    .buttonStyle(Flat())
                    .frame(width: 82, height: 64)
                    .accessibilityIdentifier("lab.\(cell.id).tab.\(name)")
                    .accessibilityLabel(name)
                }
            }
            .padding(.top, 12)
        }
        .frame(width: screen.width - 48, height: 87)
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { lab.chrome("tabBar", $0) }
        .position(x: x, y: pillTop + 87 / 2)
    }
}

/// `fab`: a scroll view (`list`, the safe area's height) under a transparent full-width host (128 pt, 16 pt above the
/// home indicator's band, an accessibility container `lab.fab.host`) holding only a round 96-pt FAB (chrome `fab`): L
/// and K lie in the host's band beside the FAB, W above it (calibration.json #24's shape).
struct FabCell: View {
    @EnvironmentObject var lab: Lab
    let cell: Cell
    let screen: CGSize
    let insets: UIEdgeInsets

    var body: some View {
        let x = screen.width / 2
        let listHeight = screen.height - insets.top - insets.bottom
        let hostTop = screen.height - insets.bottom - 16 - 128
        let beside = CGSize(width: (screen.width - 96) / 2 - 32, height: slot.height)
        // Content coordinates: the list starts at the top inset.
        let inList = { (y: CGFloat) in y - insets.top }
        ScrollView {
            ZStack(alignment: .topLeading) {
                Color.white.frame(width: screen.width, height: listHeight + 400)
                BarTarget(cell: cell, tag: "W", size: slot).position(x: x, y: inList(hostTop - 200 + slot.height / 2))
                BarTarget(cell: cell, tag: "L", size: beside).position(x: 16 + beside.width / 2, y: inList(hostTop + 64))
                BarTarget(cell: cell, tag: "K", size: beside).position(x: screen.width - 16 - beside.width / 2, y: inList(hostTop + 64))
            }
            .frame(width: screen.width, height: listHeight + 400)
        }
        .frame(width: screen.width, height: listHeight)
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { lab.scrollView("list", $0) }
        .position(x: x, y: insets.top + listHeight / 2)
        ZStack {
            Button {
                lab.event("button", "fab.add")
            } label: {
                Circle().fill(fabColour)
            }
            .buttonStyle(Flat())
            .frame(width: 96, height: 96)
            .accessibilityIdentifier("lab.\(cell.id).fab")
            .accessibilityLabel("Add")
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { lab.chrome("fab", $0) }
        }
        .frame(width: screen.width, height: 128)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("lab.\(cell.id).host")
        .position(x: x, y: hostTop + 64)
    }
}

/// `tabbar-hidden-push` (layer `tab-host`, iOS only): a tab host — a NavigationStack under a custom floating tab bar
/// (four items, as an app's own bar is: no TabView) — whose first screen pushes the cell's screen and hides the bar
/// while it is shown (opacity 0, not hit-testable). WDA keeps the hidden bar's buttons in its tree, `isVisible="0"`,
/// over the pushed screen's rows (calibration.json #26). A, B, C lie where those phantom buttons are listed; nothing is
/// drawn over them. Ready once the push has settled.
struct HiddenTabPush: View {
    @EnvironmentObject var lab: Lab
    let cell: Cell
    @State private var path: [String] = []

    var body: some View {
        let screen = UIScreen.main.bounds.size
        ZStack(alignment: .topLeading) {
            NavigationStack(path: $path) {
                Color.white
                    .navigationTitle("Host")
                    .navigationDestination(for: String.self) { _ in PushedScreen(cell: cell) }
            }
            HStack(spacing: 0) {
                ForEach(["home", "transactions", "cards", "more"], id: \.self) { name in
                    Button {
                        lab.event("tab", name)
                    } label: {
                        RoundedRectangle(cornerRadius: 16).fill(chromeItem)
                    }
                    .buttonStyle(Flat())
                    .frame(width: 82, height: 64)
                    .accessibilityIdentifier("lab.\(cell.id).tab.\(name)")
                    .accessibilityLabel(name.capitalized)
                }
            }
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 32).fill(chromeColour))
            .position(x: screen.width / 2, y: screen.height - 44 - 44)
            .opacity(path.isEmpty ? 1 : 0)
            .allowsHitTesting(path.isEmpty)
        }
        .frame(width: screen.width, height: screen.height)
        .ignoresSafeArea()
        .task {
            try? await Task.sleep(for: .milliseconds(300))
            path = ["pushed"]
            try? await Task.sleep(for: .milliseconds(1200))
            lab.safeArea()
            try? await Task.sleep(for: .milliseconds(300))
            lab.settled()
        }
    }
}

/// The pushed screen: the targets at fixed rows, the tab bar hidden.
struct PushedScreen: View {
    let cell: Cell

    /// Where A, B and C are centred, in points from the screen's top: the rows WDA lists the hidden bar's buttons over
    /// (measured on the iPhone 17, iOS 27.0).
    static let rows: [String: CGFloat] = ["A": 640, "B": 730, "C": 810]

    var body: some View {
        let screen = UIScreen.main.bounds.size
        ZStack(alignment: .topLeading) {
            Color.white
            ForEach(["A", "B", "C"], id: \.self) { tag in
                BarTarget(cell: cell, tag: tag, size: slot).position(x: screen.width / 2, y: Self.rows[tag]!)
            }
        }
        .frame(width: screen.width, height: screen.height)
        .ignoresSafeArea()
        .navigationTitle("Pushed")
    }
}
