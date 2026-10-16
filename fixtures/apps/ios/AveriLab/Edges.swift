import SwiftUI
import UIKit

// The edges family (fixtures/apps/cells/edges.json): targets at an edge of their scroll view (cut, a sliver, outside
// its clip, overlapped by a sticky header) or of the screen (off it, resting in the status band). Each target is
// Base.swift's TargetView (300×64, its global frame — unclipped: the frame runs on past the clip) at a fixed place in a
// scroll view's content, the scroll view at a fixed place on the screen and scrolled to a fixed offset on appear. The
// state reports what the targets' geometry is measured against (scripts/truth/truth.ts#geometryOf): the window's
// safe-area insets, each scroll view's clip (its global frame), the sticky header as chrome. Edges.kt lays out the
// same numbers in dp.

/// A scroll view of an edges cell: its top on the screen and its height (nil: to the screen's bottom), its content's
/// height (nil: its height plus the offset — scrolled to its end on appear), the offset it is scrolled to on appear, and
/// the top of each target in its content.
struct EdgeScroller {
    let id: String
    let top: CGFloat
    let height: CGFloat?
    let content: CGFloat?
    let offset: CGFloat
    let rows: [(tag: String, y: CGFloat)]
}

enum EdgeLayout {
    /// The geometry each target is built for (on the iPhone 17, 402×874 pt, status band 62 pt, home band 34 pt; on the
    /// Pixel 3a, 392×807 dp): the minimum tap piece is 6 % of the screen's shorter side (24 pt; 65 px = 23.6 dp).
    static func scrollers(_ cell: String) -> [EdgeScroller] {
        switch cell {
        case "scroll-bounded":
            return [
                // upper, clip 110–330: W whole (120–184); P cut by the clip's bottom (290–354, 40 shows, its centre
                // 322 inside: partly-centre-in — calibration.json #12, R-fully).
                EdgeScroller(id: "upper", top: 110, height: 220, content: 700, offset: 0, rows: [("W", 10), ("P", 180)]),
                // lower, clip 380–560: S cut by the clip's bottom to 8 (552–616: a sliver, #13); O below the clip but
                // on the screen (620–684: outside-scroll-view, #29); F laid out below the screen (1380–1444:
                // off-screen, #4).
                EdgeScroller(id: "lower", top: 380, height: 180, content: 1300, offset: 0, rows: [("S", 172), ("O", 240), ("F", 1000)]),
            ]
        case "scroll-top-edge":
            // page, the whole screen, scrolled 382: A above the screen (-282 – -218: off-screen); T resting in the
            // status band, cut by the screen's top (-2–62), its centre 30 under the status bar itself: status-band,
            // #17's static half. A raw tap there never reaches the app's window (measured on iOS 27: y ≤ 50 logs no
            // touch, ≥ 55 does — truth.ts#statusBarMaySwallow), so its probe is the bar's, as on Android. Edges.kt
            // scrolls 400 dp (T -20–44 dp, its centre 12 dp inside Android's 24-dp status bar).
            return [EdgeScroller(id: "page", top: 0, height: nil, content: 2400, offset: 382, rows: [("A", 100), ("T", 380)])]
        case "scroll-top-edge-end":
            // scroll-top-edge's page, its content ending at the screen's bottom (scrolled to its end): T rests in the
            // status band with nothing more to scroll toward the content's end — a stroke that way moves nothing, so
            // only a turn back reveals T (calibration.json #17's turn-back, live: scripts/truth/live.ts).
            return [EdgeScroller(id: "page", top: 0, height: nil, content: nil, offset: 382, rows: [("A", 100), ("T", 380)])]
        default:
            return []
        }
    }

    /// scroll-sticky: a lazy list (clip 110–560) whose section header (56 tall) is pinned at its top, scrolled 24 — R,
    /// the first row, lies 142–206, its top 24 under the header, its centre (174) clear of it: chrome-overlap
    /// (calibration.json #9, R-fully).
    static let sticky = (top: CGFloat(110), height: CGFloat(450), header: CGFloat(56), offset: CGFloat(24))
}

struct EdgesScreen: View {
    @EnvironmentObject var lab: Lab
    let cell: Cell

    var body: some View {
        let screen = UIScreen.main.bounds.size
        ZStack(alignment: .topLeading) {
            Color.white
            if cell.id == "scroll-sticky" {
                StickyList(cell: cell, screen: screen)
            } else {
                ForEach(EdgeLayout.scrollers(cell.id), id: \.id) { s in
                    EdgeScrollView(cell: cell, scroller: s, screen: screen)
                }
            }
        }
        .frame(width: screen.width, height: screen.height)
        .ignoresSafeArea()
        .task {
            lab.safeArea()
            // The offsets applied and the frames reported before the capture reads the state.
            try? await Task.sleep(for: .milliseconds(1000))
            lab.settled()
        }
    }
}

/// One scroll view, its content a column of the screen's width with each target centred at its place.
struct EdgeScrollView: View {
    @EnvironmentObject var lab: Lab
    let cell: Cell
    let scroller: EdgeScroller
    let screen: CGSize
    @State private var position = ScrollPosition()

    var body: some View {
        let height = scroller.height ?? screen.height - scroller.top
        let content = scroller.content ?? height + scroller.offset
        ScrollView {
            ZStack(alignment: .topLeading) {
                Color.clear.frame(width: screen.width, height: content)
                ForEach(scroller.rows, id: \.tag) { row in
                    if let t = cell.targets.first(where: { $0.tag == row.tag }) {
                        TargetView(cell: cell, target: t).position(x: screen.width / 2, y: row.y + Slot.size.height / 2)
                    }
                }
            }
            .frame(width: screen.width, height: content)
        }
        .labScroll(scroller.id, lab)
        .scrollPosition($position)
        .scrollIndicators(.hidden)
        .contentMargins(0, for: .scrollContent)
        .ignoresSafeArea()
        .background(Color(hex: "#EEEEEE"))
        .frame(width: screen.width, height: height)
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { lab.scrollView(scroller.id, $0) }
        .position(x: screen.width / 2, y: scroller.top + height / 2)
        .onAppear { position.scrollTo(y: scroller.offset) }
    }
}

/// scroll-sticky's list: a lazy stack whose section header is pinned at the list's top, reported as chrome.
struct StickyList: View {
    @EnvironmentObject var lab: Lab
    let cell: Cell
    let screen: CGSize
    @State private var position = ScrollPosition()

    var body: some View {
        let l = EdgeLayout.sticky
        ScrollView {
            LazyVStack(spacing: 0, pinnedViews: [.sectionHeaders]) {
                Section {
                    ForEach(cell.targets, id: \.tag) { t in TargetView(cell: cell, target: t) }
                    ForEach(0..<15, id: \.self) { _ in Color.clear.frame(width: screen.width, height: Slot.size.height) }
                } header: {
                    Text("Sticky header")
                        .foregroundStyle(.white)
                        .frame(width: screen.width, height: l.header)
                        .background(Color(hex: "#455A64"))
                        .accessibilityIdentifier("lab.\(cell.id).header")
                        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { lab.chrome("stickyHeader", $0) }
                }
            }
        }
        .labScroll("list", lab)
        .scrollPosition($position)
        .scrollIndicators(.hidden)
        .contentMargins(0, for: .scrollContent)
        .ignoresSafeArea()
        .background(Color(hex: "#EEEEEE"))
        .frame(width: screen.width, height: l.height)
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { lab.scrollView("list", $0) }
        .position(x: screen.width / 2, y: l.top + l.height / 2)
        .onAppear { position.scrollTo(y: l.offset) }
    }
}
