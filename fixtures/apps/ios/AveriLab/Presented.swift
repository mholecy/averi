import SwiftUI
import UIKit

// The presented family (fixtures/apps/cells/presented.json): a layer presented over the coloured-target host
// (Base.swift) — a sheet at the medium detent with its own target, an alert (phase 1); phase 3's cells: the medium sheet
// over a scrolled host whose targets lie at its edges (sheet-medium-edges), a large sheet whose bare background lies
// over the targets (sheet-background), a large sheet holding a UIKit table longer than the screen (sheet-long-list; cut
// short of the sheet's foot, a footer under it: sheet-long-list-short), a
// transparent full-screen cover dimming the screen (dim-cover, an RN transparent Modal's shape) and an in-screen menu
// over a blurred, dimmed backdrop that no tree lists (blur-menu), and mp-native's payment-type chooser — a white card
// of option rows over a dimmed list, listed before it (chooser).

/// A presented cell's screen, by its layer: the scrolled host, the blur menu, the chooser, else the slot host (Base.swift#CellScreen)
/// with the layer raised over it (PresentedLayer).
struct PresentedScreen: View {
    let cell: Cell

    var body: some View {
        switch cell.layer {
        case "sheet-medium-scrolled": ScrolledHost(cell: cell)
        case "blur-menu", "blur-menu-grouped", "blur-menu-stacked", "blur-menu-unhidden": BlurMenuScreen(cell: cell)
        case "chooser": ChooserScreen(cell: cell)
        default: CellScreen(cell: cell)
        }
    }
}

/// The layers presented as a sheet, and at which detent.
private let sheetDetents: [String: PresentationDetent] = [
    "sheet-medium": .medium, "sheet-medium-scrolled": .medium, "sheet-large": .large, "sheet-list": .large,
    "sheet-list-short": .large,
]
/// The layers whose cells report what a geometry is measured against (the safe area, their scroll views' clips).
private let measuredLayers: Set<String> = ["sheet-medium-scrolled", "sheet-list", "sheet-list-short"]

/// The cell's layer, raised after the screen beneath has appeared, and the state marked ready once it has settled — a
/// cell with layer `none` (base's `open`) raises nothing and is ready after 300 ms.
struct PresentedLayer: ViewModifier {
    @EnvironmentObject var lab: Lab
    let cell: Cell
    @State private var sheet = false
    @State private var alert = false
    @State private var cover = false

    func body(content: Content) -> some View {
        content
            .sheet(isPresented: $sheet, onDismiss: { lab.event("dismissed", "sheet") }) {
                SheetContent(cell: cell)
                    .presentationDetents([sheetDetents[cell.layer] ?? .medium])
                    .environmentObject(lab)
            }
            .alert("Lab alert", isPresented: $alert) {
                Button("Keep", role: .cancel) { lab.event("button", "Keep") }
                Button("Discard", role: .destructive) { lab.event("button", "Discard") }
            } message: {
                Text("A presented layer over the targets.")
            }
            .fullScreenCover(isPresented: $cover) {
                DimCover(cell: cell).environmentObject(lab)
            }
            .task {
                // The layer is presented after the screen beneath has appeared — as an app raises it — and the state is
                // marked ready once the presentation has had time to finish animating.
                try? await Task.sleep(for: .milliseconds(300))
                if sheetDetents[cell.layer] != nil {
                    sheet = true
                } else if cell.layer == "alert" {
                    alert = true
                } else if cell.layer == "dim-cover" {
                    // An RN transparent Modal fades in; no slide: the screenshot shows the cover where it rests.
                    var t = Transaction()
                    t.disablesAnimations = true
                    withTransaction(t) { cover = true }
                }
                try? await Task.sleep(for: .milliseconds(cell.layer == "none" ? 300 : 1200))
                if measuredLayers.contains(cell.layer) { lab.safeArea() }
                lab.settled()
            }
    }
}

struct SheetContent: View {
    @EnvironmentObject var lab: Lab
    let cell: Cell

    var body: some View {
        if cell.layer == "sheet-list" {
            LongList(cell: cell, lab: lab).ignoresSafeArea(edges: .bottom)
        } else if cell.layer == "sheet-list-short" {
            // sheet-long-list-short: the table cut short of the sheet's foot, a plain footer under it — a row below the
            // table's clip lies on the screen, over the footer (calibration.json #20's R-outside-sv).
            VStack(spacing: 0) {
                LongList(cell: cell, lab: lab).frame(height: LongListController.shortHeight)
                Color(hex: LongListController.footer).accessibilityHidden(true)
            }
            .ignoresSafeArea(edges: .bottom)
        } else {
            // sheet-medium: its target S at the top; sheet-background (`sheet-large`): S at the top, the rest of the
            // sheet its bare background — no node of its own over the targets beneath; sheet-medium-edges: no target.
            VStack(spacing: 24) {
                ForEach(cell.targets.filter(\.onLayer), id: \.tag) { t in
                    TargetView(cell: cell, target: t)
                }
                Spacer()
            }
            .padding(.top, 40)
            .frame(maxWidth: .infinity)
        }
    }
}

// --- sheet-medium-edges: the host scrolled, its targets at the screen's edges beneath the sheet ---

/// A scroll view over the whole screen, scrolled `offset` down on appear, its targets placed in the content so that,
/// beneath the medium sheet: slot 0 lies wholly above the screen, slot 1 wholly under the status bar (its top above the
/// screen), slot 2 shows 5 pt at the screen's bottom (under the sheet), slot 3 lies wholly below it; slot 4 lies whole
/// on the screen under the sheet's dim — the cell's positive control, the one target whose probe is delivered.
struct ScrolledHost: View {
    @EnvironmentObject var lab: Lab
    let cell: Cell
    @State private var position = ScrollPosition(edge: .top)

    static let offset: CGFloat = 200
    /// Each slot's top in the content; less `offset`, on the screen: -88, -20, 869, 1009, 290.
    static let tops: [CGFloat] = [112, 180, 1069, 1209, 490]

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width + geo.safeAreaInsets.leading + geo.safeAreaInsets.trailing
            ScrollView {
                ZStack(alignment: .topLeading) {
                    Color.white.frame(width: width, height: 1600)
                    ForEach(cell.targets.filter { !$0.onLayer }, id: \.tag) { t in
                        TargetView(cell: cell, target: t)
                            .position(x: width / 2, y: Self.tops[t.slot] + Slot.size.height / 2)
                    }
                }
            }
            .labScroll("host", lab)
            .scrollPosition($position)
            .contentMargins(0, for: .scrollContent)
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { lab.scrollView("host", $0) }
            .onAppear { position.scrollTo(y: Self.offset) }
            .ignoresSafeArea()
        }
        .ignoresSafeArea()
        .modifier(PresentedLayer(cell: cell))
    }
}

// --- dim-cover: an RN transparent Modal's shape ---

/// A full-screen cover with a clear background: a screen-sized dimming container, identified, holding a card with the
/// layer's target — an RN `Modal transparent` whose root View (testID) tints the screen beneath. A touch on the dim does
/// nothing (the cover takes it).
struct DimCover: View {
    @EnvironmentObject var lab: Lab
    let cell: Cell

    var body: some View {
        ZStack {
            Color.black.opacity(0.4)
            VStack(spacing: 16) {
                ForEach(cell.targets.filter(\.onLayer), id: \.tag) { t in
                    TargetView(cell: cell, target: t)
                }
            }
            .padding(24)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 16))
        }
        .ignoresSafeArea()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("lab.\(cell.id).overlay")
        .presentationBackground(.clear)
    }
}

// --- sheet-long-list: a UIKit table in a large sheet ---

/// A UITableView of `LongListController.rows` rows, 64 pt each; a row whose index is a layer target's slot is that
/// target (its colour, its identifier on the label that fills it), every other row a grey "Row n". UIKit's
/// accessibility lists the rows below the fold too, asking the data source for cells it never lays out.
struct LongList: UIViewControllerRepresentable {
    let cell: Cell
    let lab: Lab

    func makeUIViewController(context: Context) -> LongListController { LongListController(cell: cell, lab: lab) }
    func updateUIViewController(_ controller: LongListController, context: Context) {}
}

final class LongListController: UITableViewController {
    /// Long enough for ADR 0021 decision 4's long-list half: sheet-long-list's L (row 30) lies wholly before the
    /// table's end (offset 56 × 64 − 812 = 2772) and past one stroke's carry from the top — a full final stroke
    /// overshoots it (scripts/truth/live-visibility.ts#CARRY). 40 rows until round 7 ended inside its window; 80 (tried
    /// first) made each WDA `/source` ~1.7 s, a 15 s scroll_until timing out after 5 swipes.
    static let rows = 56
    static let rowHeight: CGFloat = 64
    /// sheet-long-list-short's table: six rows tall (rows 0–5 laid out, row 6 on cut at the clip), its footer's colour
    /// none of a target's.
    static let shortHeight: CGFloat = 384
    static let footer = "#CFD8DC"
    private let cell: Cell
    private let lab: Lab
    private let targets: [Int: Target]

    init(cell: Cell, lab: Lab) {
        self.cell = cell
        self.lab = lab
        targets = Dictionary(cell.targets.filter(\.onLayer).map { ($0.slot, $0) }) { a, _ in a }
        super.init(style: .plain)
    }

    required init?(coder: NSCoder) { fatalError("not from a storyboard") }

    override func viewDidLoad() {
        super.viewDidLoad()
        tableView.separatorStyle = .none
        tableView.rowHeight = Self.rowHeight
        tableView.backgroundColor = .white
    }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { Self.rows }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let row = UITableViewCell(style: .default, reuseIdentifier: nil)
        row.selectionStyle = .none
        let label = UILabel()
        label.translatesAutoresizingMaskIntoConstraints = false
        row.contentView.addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: row.contentView.leadingAnchor),
            label.trailingAnchor.constraint(equalTo: row.contentView.trailingAnchor),
            label.topAnchor.constraint(equalTo: row.contentView.topAnchor),
            label.bottomAnchor.constraint(equalTo: row.contentView.bottomAnchor),
        ])
        if let t = targets[indexPath.row] {
            // A solid rectangle of its own colour: the text drawn in it, so nothing else shows.
            let colour = UIColor(Color(hex: t.color))
            label.backgroundColor = colour
            label.textColor = colour
            label.text = "Target \(t.tag)"
            label.accessibilityIdentifier = "lab.\(cell.id).\(t.tag)"
        } else {
            label.textColor = .gray
            label.text = "Row \(indexPath.row)"
        }
        return row
    }

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        if let t = targets[indexPath.row] { lab.event("tap", t.tag) }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        report()
    }

    /// Once the sheet has finished sliding in: the layout pass may have run while it was still moving.
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        report()
    }

    // The live golden's oracle (Lab.offset, Lab.scrolling): the table's offset, and each stroke from the drag's start
    // until it rests (no fling: at the drag's end; a fling: once it has decelerated).
    override func scrollViewDidScroll(_ scrollView: UIScrollView) {
        lab.offset("list", Double(scrollView.contentOffset.y + scrollView.adjustedContentInset.top))
    }

    override func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
        lab.scrolling("list", true, Double(scrollView.contentOffset.y + scrollView.adjustedContentInset.top))
    }

    override func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
        if !decelerate { lab.scrolling("list", false, Double(scrollView.contentOffset.y + scrollView.adjustedContentInset.top)) }
    }

    override func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) {
        lab.scrolling("list", false, Double(scrollView.contentOffset.y + scrollView.adjustedContentInset.top))
    }

    /// Each target's row and the table's clip, in screen points — rows below the fold included (rectForRow needs no
    /// cell).
    private func report() {
        guard let window = view.window else { return }
        let toScreen = { (r: CGRect) in window.convert(r, to: window.screen.coordinateSpace) }
        lab.scrollView("list", toScreen(tableView.convert(tableView.bounds, to: nil)))
        for (index, t) in targets {
            lab.frame(t.tag, toScreen(tableView.convert(tableView.rectForRow(at: IndexPath(row: index, section: 0)), to: nil)))
        }
    }
}

// --- blur-menu: an in-screen menu over a blurred, dimmed backdrop ---

/// The slot host blurred and dimmed under a menu card holding the layer's targets — the card inside the screen's own
/// container, declared (so listed) BEFORE the targets it is drawn over, the backdrop no accessibility element: neither
/// tree lists anything over the targets beneath (docs/bugs …-swiftui-blur-overlay-has-no-node…). A touch on the
/// backdrop closes the menu (`dismissed menu`). Ungrouped (`blur-menu`), SwiftUI lists every target in one container in
/// reading order — the card's rows between the targets above and below them; grouped (`blur-menu-grouped`), the card
/// and the screen beneath are each an accessibility container of the screen's size, the card's declared first: its rows
/// listed before every target beneath, which starts above them (mp-native's chooser under idb, ADR 0015).
/// ADR 0018 residual 9's probes (round 16), each grouped: `blur-menu-stacked` declares the three in the order they are
/// drawn (the screen beneath, the backdrop, the card; no zIndex) — with blur-menu-grouped's reverse declaration it
/// tells whether WDA lists the backdrop and the screen beneath, both at 0,0 the screen's size, in draw order or in
/// declaration order; `blur-menu-unhidden` is blur-menu-grouped with the backdrop not `.accessibilityHidden`.
struct BlurMenuScreen: View {
    @EnvironmentObject var lab: Lab
    let cell: Cell
    @State private var menu = false

    /// The card's rows' centres: the second lies inside slot 2's target, drawn over its top.
    static let rowCentres: [CGFloat] = [412, 480]

    private var grouped: Bool { cell.layer != "blur-menu" }
    private var stacked: Bool { cell.layer == "blur-menu-stacked" }

    var body: some View {
        GeometryReader { geo in
            let screen = CGSize(width: geo.size.width + geo.safeAreaInsets.leading + geo.safeAreaInsets.trailing,
                                height: geo.size.height + geo.safeAreaInsets.top + geo.safeAreaInsets.bottom)
            ZStack(alignment: .topLeading) {
                if stacked {
                    beneath(screen)
                    if menu {
                        backdrop
                        card(screen)
                    }
                } else {
                    if menu {
                        card(screen).zIndex(2)
                        backdrop.zIndex(1)
                    }
                    beneath(screen).zIndex(0)
                }
            }
            .frame(width: screen.width, height: screen.height)
            .ignoresSafeArea()
        }
        .ignoresSafeArea()
        .task {
            try? await Task.sleep(for: .milliseconds(300))
            var t = Transaction()
            t.disablesAnimations = true
            withTransaction(t) { menu = true }
            try? await Task.sleep(for: .milliseconds(800))
            lab.settled()
        }
    }

    /// The menu's card: the layer's targets at the card's rows.
    private func card(_ screen: CGSize) -> some View {
        ZStack(alignment: .topLeading) {
            ForEach(cell.targets.filter(\.onLayer), id: \.tag) { t in
                TargetView(cell: cell, target: t).position(x: screen.width / 2, y: Self.rowCentres[t.slot])
            }
        }
        .frame(width: screen.width, height: screen.height)
        .modifier(Grouped(on: grouped))
    }

    /// The dim over the screen beneath, closing the menu on a touch.
    private var backdrop: some View {
        Color.black.opacity(0.25)
            .contentShape(Rectangle())
            .onTapGesture {
                menu = false
                lab.event("dismissed", "menu")
            }
            .accessibilityHidden(cell.layer != "blur-menu-unhidden")
    }

    /// The slot host, blurred while the menu is up.
    private func beneath(_ screen: CGSize) -> some View {
        ZStack(alignment: .topLeading) {
            Color.white
            ForEach(cell.targets.filter { !$0.onLayer }, id: \.tag) { t in
                TargetView(cell: cell, target: t).position(Slot.centre(t.slot, in: screen))
            }
        }
        .modifier(Grouped(on: grouped))
        .blur(radius: menu ? 6 : 0)
    }
}

/// An accessibility container of its children, when `on`.
struct Grouped: ViewModifier {
    let on: Bool

    func body(content: Content) -> some View {
        if on { content.accessibilityElement(children: .contain) } else { content }
    }
}

// --- chooser: a white card of option rows presented in-screen over a dimmed list ---

/// mp-native's payment-type chooser (tests/fixtures/idb-modal-listed-before-content.json, `chooser`; ADR 0015), rebuilt
/// at its measured geometry: a white card (24,381 354×140, no accessibility element) holding the option rows O
/// (`To my account` 45,397 312×52) and S (`SWIFT payment` 45,453 312×52), white on white, over a list dimmed by a
/// backdrop no tree lists — date headers (0,y 402×29, Header trait) and white transaction rows (24,y 354×52), R the first
/// (`row_0` 24,435), whose band 435–487 holds S's centre (201,479). The card and the list are each an accessibility
/// container of the screen's size, the card's declared first, so idb lists O and S BEFORE the list drawn under them (the
/// filter icon 348,358 first, its top above both). A touch on the backdrop closes the chooser (`dismissed menu`); one on
/// the card's own padding does nothing.
struct ChooserScreen: View {
    @EnvironmentObject var lab: Lab
    let cell: Cell
    @State private var menu = false

    /// Each row's frame and title, by tag: the card's (O, S) and the list's (R; the other list rows carry no tag).
    static let rows: [String: (CGRect, String)] = [
        "O": (CGRect(x: 45, y: 397, width: 312, height: 52), "To my account"),
        "S": (CGRect(x: 45, y: 453, width: 312, height: 52), "SWIFT payment"),
        "R": (CGRect(x: 24, y: 435, width: 354, height: 52), "Loan repayment, 17.07.2026, +602,00 EUR"),
    ]
    static let card = CGRect(x: 24, y: 381, width: 354, height: 140)
    /// The list beneath: its date headers' tops, and its untagged rows (top, title).
    static let headers: [(CGFloat, String)] = [(399, "17.07.2026"), (494, "15.07.2026"), (590, "02.07.2026"), (685, "25.06.2026"), (780, "14.06.2026")]
    static let others: [(CGFloat, String)] = [(531, "Loan repayment, 15.07.2026, +573,00 EUR"), (626, "Loan repayment, 02.07.2026, +627,00 EUR"),
                                             (721, "Loan repayment, 25.06.2026, +162,00 EUR"), (817, "Loan repayment, 14.06.2026, +208,00 EUR")]

    var body: some View {
        GeometryReader { geo in
            let screen = CGSize(width: geo.size.width + geo.safeAreaInsets.leading + geo.safeAreaInsets.trailing,
                                height: geo.size.height + geo.safeAreaInsets.top + geo.safeAreaInsets.bottom)
            ZStack(alignment: .topLeading) {
                if menu {
                    ZStack(alignment: .topLeading) {
                        RoundedRectangle(cornerRadius: 16).fill(Color.white)
                            .frame(width: Self.card.width, height: Self.card.height)
                            .contentShape(Rectangle())
                            .onTapGesture {}
                            .accessibilityHidden(true)
                            .position(x: Self.card.midX, y: Self.card.midY)
                        ForEach(cell.targets.filter(\.onLayer), id: \.tag) { t in
                            ChooserRow(cell: cell, target: t)
                        }
                    }
                    .frame(width: screen.width, height: screen.height)
                    .accessibilityElement(children: .contain)
                    .zIndex(2)
                    Color.black.opacity(0.4)
                        .contentShape(Rectangle())
                        .onTapGesture {
                            menu = false
                            lab.event("dismissed", "menu")
                        }
                        .accessibilityHidden(true)
                        .zIndex(1)
                }
                ZStack(alignment: .topLeading) {
                    Color(hex: "#F2F2F7")
                    Button { lab.event("button", "list.filter") } label: { Image(systemName: "line.3.horizontal.decrease").resizable() }
                        .buttonStyle(Flat())
                        .frame(width: 17, height: 10)
                        .accessibilityLabel("Filter transactions")
                        .accessibilityIdentifier("lab.\(cell.id).filter")
                        .position(x: 348 + 8.5, y: 358 + 5)
                    ForEach(Self.headers, id: \.0) { h in
                        // One element of the header's whole band (0,y 402×29), as mp-native's date headers are listed.
                        ZStack(alignment: .leading) {
                            Color.clear
                            Text(h.1).font(.footnote).foregroundStyle(.gray).padding(.leading, 24)
                        }
                        .frame(width: screen.width, height: 29)
                        .accessibilityElement(children: .combine)
                        .accessibilityAddTraits(.isHeader)
                            .position(x: screen.width / 2, y: h.0 + 14.5)
                    }
                    ForEach(cell.targets.filter { !$0.onLayer }, id: \.tag) { t in
                        ChooserRow(cell: cell, target: t)
                    }
                    ForEach(Self.others, id: \.0) { r in
                        Button { lab.event("button", "list.row") } label: { RowLabel(title: r.1, color: "#FFFFFF") }
                            .buttonStyle(Flat())
                            .frame(width: 354, height: 52)
                            .position(x: 24 + 177, y: r.0 + 26)
                    }
                }
                .frame(width: screen.width, height: screen.height)
                .accessibilityElement(children: .contain)
                .zIndex(0)
            }
            .frame(width: screen.width, height: screen.height)
            .ignoresSafeArea()
        }
        .ignoresSafeArea()
        .task {
            try? await Task.sleep(for: .milliseconds(300))
            var t = Transaction()
            t.disablesAnimations = true
            withTransaction(t) { menu = true }
            try? await Task.sleep(for: .milliseconds(800))
            lab.settled()
        }
    }
}

/// A chooser cell's tagged row at its frame (ChooserScreen.rows): its colour with its title, read by that title.
private struct ChooserRow: View {
    @EnvironmentObject var lab: Lab
    let cell: Cell
    let target: Target

    var body: some View {
        let (frame, title) = ChooserScreen.rows[target.tag]!
        Button {
            lab.event("tap", target.tag)
        } label: {
            RowLabel(title: title, color: target.color)
        }
        .buttonStyle(Flat())
        .frame(width: frame.width, height: frame.height)
        .accessibilityIdentifier("lab.\(cell.id).\(target.tag)")
        .accessibilityLabel(title)
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { lab.frame(target.tag, $0) }
        .position(x: frame.midX, y: frame.midY)
    }
}

/// A list row's face: its colour, its title in black at its leading edge.
private struct RowLabel: View {
    let title: String
    let color: String

    var body: some View {
        ZStack(alignment: .leading) {
            Rectangle().fill(Color(hex: color))
            Text(title).font(.subheadline).foregroundStyle(.black).lineLimit(1).padding(.horizontal, 16)
        }
    }
}
