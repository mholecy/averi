import SwiftUI

// The presented family (fixtures/apps/cells/presented.json): a layer presented over the coloured-target host
// (Base.swift) — a sheet at the medium detent with its own target, an alert. Phase 3's presented cells (a sheet's
// edges, a large sheet's bare background, a dim, a blur) are added here.

/// The cell's layer, raised after the screen beneath has appeared, and the state marked ready once it has settled — a
/// cell with layer `none` (base's `open`) raises nothing and is ready after 300 ms.
struct PresentedLayer: ViewModifier {
    @EnvironmentObject var lab: Lab
    let cell: Cell
    @State private var sheet = false
    @State private var alert = false

    func body(content: Content) -> some View {
        content
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
