import SwiftUI

// The bars family (fixtures/apps/cells/bars.json): the status and navigation bands, a floating or hidden tab bar, a FAB — phase 3's B4 builds its cells here, on the
// coloured-target pieces of Base.swift (TargetView, Flat), reporting what its geometry needs in the state
// (Lab.swift#LabState: safeArea, scrollViews, chrome).

struct BarsScreen: View {
    let cell: Cell

    var body: some View {
        UnbuiltCell(cell: cell)
    }
}
