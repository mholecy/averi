import SwiftUI

// The false-covers family (fixtures/apps/cells/false-covers.json): a target's own parts, a toolbar host over the
// keyboard dismissal — phase 3's B5 builds its cells here, on the coloured-target pieces of Base.swift (TargetView,
// Flat), reporting what its geometry needs in the state (Lab.swift#LabState: safeArea, scrollViews, chrome).

struct FalseCoversScreen: View {
    let cell: Cell

    var body: some View {
        UnbuiltCell(cell: cell)
    }
}
