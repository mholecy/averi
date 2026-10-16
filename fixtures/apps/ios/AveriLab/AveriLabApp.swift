import SwiftUI

// The iOS lab app (docs/plans/2026-10-15-ground-truth-lab-app.md): one cell of fixtures/apps/cells.json per launch,
// chosen by the launch argument `-cell <id>` or the deep link `averilab://cell/<id>`. No login, no network, no data.
// One file per cell family (fixtures/apps/cells/<family>.json): Base.swift, Presented.swift, Forms.swift, Edges.swift,
// Bars.swift, FalseCovers.swift; CellRouter below sends a cell to its family's screen.

@main
struct AveriLabApp: App {
    @StateObject private var lab = Lab()

    var body: some Scene {
        WindowGroup {
            Group {
                if let cell = lab.cell {
                    CellRouter.screen(for: cell).id(cell.id)
                } else {
                    CellList()
                }
            }
            .environmentObject(lab)
            // The keyboard's frame for the form oracle: its end frame, screen coordinates (a hide ends below the
            // screen).
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

/// A cell's screen, by its family (the catalog stamps each cell with it, scripts/truth/catalog.ts). A family adds its
/// cells in its own file; this switch names every family of scripts/truth/schema.ts#FAMILIES once, so no batch of phase
/// 3 edits it. A family it does not name (or none) shows an UnbuiltCell, never ready: a capture of it times out naming
/// the cell.
enum CellRouter {
    @MainActor @ViewBuilder
    static func screen(for cell: Cell) -> some View {
        switch cell.family {
        case "forms":
            if let form = cell.form { FormScreen(cell: cell, form: form) } else { UnbuiltCell(cell: cell) }
        case "edges": EdgesScreen(cell: cell)
        case "bars": BarsScreen(cell: cell)
        case "false-covers": FalseCoversScreen(cell: cell)
        // The coloured-target host (Base.swift); a presented cell's host and layer (Presented.swift).
        case "base": CellScreen(cell: cell)
        case "presented": PresentedScreen(cell: cell)
        default: UnbuiltCell(cell: cell)
        }
    }
}

/// A cell of a family whose screen does not build it yet: said on screen, never `ready` — a capture of it times out
/// naming the cell instead of recording an empty screen as its truth.
struct UnbuiltCell: View {
    let cell: Cell

    var body: some View {
        Text("Cell \(cell.id): no view of family \(cell.family ?? "none") builds it yet")
            .padding()
    }
}
