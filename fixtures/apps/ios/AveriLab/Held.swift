import SwiftUI

// The held family (fixtures/apps/cells/held.json, backlog D30): a screen that renders late, for the live golden's
// `ensure` group (scripts/truth/live-ensure.ts) — ensure_state's second look on a device, ADR 0033's held "no".
//
// - `held-no`: ready at once while it draws nothing — plain white, no accessibility element: a bare tree
//   (src/ui-tree/bare-tree.ts; tests/truth/held-bare.test.ts) — for the catalog's `held.bareMs` (6 s: long, so the
//   launch rarely outruns the call); then Text "Welcome" and Button "Continue"; Continue shows Text "Home".
// - `held-no-spinner`: the same, with `held.spinnerMs` (4 s) of an unlabelled ProgressView (UIActivityIndicatorView
//   beneath) between the bare phase and Welcome.
//
// Each element is identified lab.<cell>.<tag> (welcome, continue, home). Every phase change is logged (`phase`, `bare`
// / `spinner` / `welcome` / `home`) before it is drawn, Continue's press as the `tap` `continue` — the judges' clock.

/// What a held cell draws, its raw value the tag its `phase` event logs. `unconfigured`: the catalog gave the cell no
/// `held` (a stale catalog, an old build) — it stays bare, and says so (live-ensure.ts SKIPs on it).
enum HeldPhase: String {
    case bare, unconfigured, spinner, welcome, home
}

struct HeldScreen: View {
    @EnvironmentObject var lab: Lab
    let cell: Cell
    @State private var phase = HeldPhase.bare

    var body: some View {
        ZStack {
            Color.white
            switch phase {
            case .bare, .unconfigured:
                EmptyView()
            case .spinner:
                ProgressView()
            case .welcome:
                VStack(spacing: 24) {
                    Text("Welcome")
                        .font(.largeTitle)
                        .accessibilityIdentifier("lab.\(cell.id).welcome")
                    Button("Continue") {
                        lab.event("tap", "continue")
                        show(.home)
                    }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("lab.\(cell.id).continue")
                }
            case .home:
                Text("Home")
                    .font(.largeTitle)
                    .accessibilityIdentifier("lab.\(cell.id).home")
            }
        }
        .ignoresSafeArea()
        .task {
            lab.event("phase", HeldPhase.bare.rawValue)
            // Ready while nothing is drawn: the launch returns into the bare phase.
            lab.settled()
            guard let held = cell.held else { return show(.unconfigured) }
            try? await Task.sleep(for: .milliseconds(held.bareMs))
            if let spinner = held.spinnerMs {
                show(.spinner)
                try? await Task.sleep(for: .milliseconds(spinner))
            }
            show(.welcome)
        }
    }

    /// The next phase, logged before it is drawn.
    private func show(_ next: HeldPhase) {
        lab.event("phase", next.rawValue)
        phase = next
    }
}
