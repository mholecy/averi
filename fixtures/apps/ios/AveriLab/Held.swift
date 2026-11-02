import SwiftUI

// The held family (fixtures/apps/cells/held.json, backlog D30): a screen that renders late, for the live golden's
// `ensure` group (scripts/truth/live-ensure.ts) — ensure_state's second look on a device, ADR 0033's held "no".
//
// - `held-no`: ready at once while it draws nothing — plain white, no accessibility element: a bare tree
//   (src/ui-tree/bare-tree.ts) — for 6 s (long, so the launch rarely outruns the call); then Text "Welcome" and
//   Button "Continue"; Continue shows Text "Home".
// - `held-no-spinner`: the same, with 4 s of an unlabelled ProgressView (UIActivityIndicatorView beneath) between the
//   bare phase and Welcome.
//
// Each element is identified lab.<cell>.<tag> (welcome, continue, home). Every phase change is logged (`phase`, `bare`
// / `spinner` / `welcome` / `home`) before it is drawn, Continue's press as the `tap` `continue` — the judges' clock.

struct HeldScreen: View {
    @EnvironmentObject var lab: Lab
    let cell: Cell
    @State private var phase = "bare"

    var body: some View {
        ZStack {
            Color.white
            switch phase {
            case "spinner":
                ProgressView()
            case "welcome":
                VStack(spacing: 24) {
                    Text("Welcome")
                        .font(.largeTitle)
                        .accessibilityIdentifier("lab.\(cell.id).welcome")
                    Button("Continue") { show("home", tap: true) }
                        .buttonStyle(.borderedProminent)
                        .accessibilityIdentifier("lab.\(cell.id).continue")
                }
            case "home":
                Text("Home")
                    .font(.largeTitle)
                    .accessibilityIdentifier("lab.\(cell.id).home")
            default:
                EmptyView()
            }
        }
        .ignoresSafeArea()
        .task {
            lab.event("phase", "bare")
            // Ready while nothing is drawn: the launch returns into the bare phase.
            lab.settled()
            try? await Task.sleep(for: .seconds(6))
            if cell.id == "held-no-spinner" {
                show("spinner")
                try? await Task.sleep(for: .seconds(4))
            }
            show("welcome")
        }
    }

    /// The next phase, logged before it is drawn; Continue's press logged first as its `tap`.
    private func show(_ next: String, tap: Bool = false) {
        if tap { lab.event("tap", "continue") }
        lab.event("phase", next)
        phase = next
    }
}
