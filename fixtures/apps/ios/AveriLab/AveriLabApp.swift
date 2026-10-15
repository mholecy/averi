import SwiftUI

// The iOS lab app (docs/plans/2026-10-15-ground-truth-lab-app.md): one cell of fixtures/apps/cells.json per launch,
// chosen by the launch argument `-cell <id>` or the deep link `averilab://cell/<id>`. No login, no network, no data.

@main
struct AveriLabApp: App {
    @StateObject private var lab = Lab()

    var body: some Scene {
        WindowGroup {
            Group {
                if let cell = lab.cell, let form = cell.form {
                    FormScreen(cell: cell, form: form).id(cell.id)
                } else if let cell = lab.cell {
                    CellScreen(cell: cell).id(cell.id)
                } else {
                    CellList()
                }
            }
            .environmentObject(lab)
            // The keyboard's frame for the form oracle: its end frame, screen coordinates (a hide ends below the screen).
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)) { n in
                if let end = n.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect { lab.keyboard(end) }
            }
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { n in
                if let end = n.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect { lab.keyboard(end) }
            }
            .onOpenURL { url in
                if url.host() == "cell", let id = url.pathComponents.dropFirst().first { lab.show(id) }
            }
        }
    }
}

/// Without a cell: the catalog, for a person poking at the app.
struct CellList: View {
    @EnvironmentObject var lab: Lab

    var body: some View {
        NavigationStack {
            List(Catalog.bundled.cells) { cell in
                Button(cell.id) { lab.show(cell.id) }
            }
            .navigationTitle("AveriLab")
        }
    }
}

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

struct CellScreen: View {
    @EnvironmentObject var lab: Lab
    let cell: Cell
    @State private var sheet = false
    @State private var alert = false

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
        .sheet(isPresented: $sheet, onDismiss: { lab.event("dismissed", "sheet") }) {
            SheetContent(cell: cell)
                .presentationDetents([.medium])
                .environmentObject(lab)
        }
        .alert("Lab alert", isPresented: $alert) {
            Button("Keep", role: .cancel) { lab.event("button", "Keep") }
            Button("Discard", role: .destructive) { lab.event("button", "Discard") }
        } message: {
            Text("A presented layer over the targets.")
        }
        .task {
            // The layer is presented after the screen beneath has appeared — as an app raises it — and the state is
            // marked ready once the presentation has had time to finish animating.
            try? await Task.sleep(for: .milliseconds(300))
            switch cell.layer {
            case "sheet-medium": sheet = true
            case "alert": alert = true
            default: break
            }
            try? await Task.sleep(for: .milliseconds(cell.layer == "none" ? 300 : 1200))
            lab.settled()
        }
    }
}

struct SheetContent: View {
    @EnvironmentObject var lab: Lab
    let cell: Cell

    var body: some View {
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
