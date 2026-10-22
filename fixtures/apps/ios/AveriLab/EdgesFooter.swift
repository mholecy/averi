import SwiftUI

// scroll-bounded-footer (fixtures/apps/cells/edges.json): scroll-bounded's `lower` scroll view (clip 380–560) with O, the row
// past its clip (620–684, drawn nowhere), and a Continue button under the clip — 16,600 370×56, listed AFTER the row in
// idb's flat list with its top ABOVE the row's — that holds the row's centre (201,652). A tap there fires Continue, not O
// (docs/bugs/2026-10-16-lab-ios-idb-lists-no-scroll-view-rows-past-its-clip-read-as-drawn.md, LE2's rest).

struct FooterScreen: View {
    @EnvironmentObject var lab: Lab
    let cell: Cell
    let screen: CGSize

    var body: some View {
        ZStack(alignment: .topLeading) {
            ForEach(EdgeLayout.scrollers(cell.id), id: \.id) { s in
                EdgeScrollView(cell: cell, scroller: s, screen: screen)
            }
            Button {
                lab.event("button", "footer.continue")
            } label: {
                RoundedRectangle(cornerRadius: 12).fill(Color(hex: "#263238"))
                    .overlay(Text("Continue").foregroundStyle(.white))
            }
            .buttonStyle(Flat())
            .frame(width: 370, height: 56)
            .accessibilityIdentifier("lab.\(cell.id).continue")
            .position(x: 16 + 185, y: 600 + 28)
        }
    }
}
