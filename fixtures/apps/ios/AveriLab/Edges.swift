import SwiftUI

// The edges family (fixtures/apps/cells/edges.json): a target cut, a sliver, outside its scroll view's clip, under a sticky header, off the screen — phase 3's B2 builds its cells here, on the
// coloured-target pieces of Base.swift (TargetView, Flat), reporting what its geometry needs in the state
// (Lab.swift#LabState: safeArea, scrollViews, chrome).

struct EdgesScreen: View {
    let cell: Cell

    var body: some View {
        UnbuiltCell(cell: cell)
    }
}
