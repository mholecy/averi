import SwiftUI
import UIKit

// The text family (fixtures/apps/cells/text.json, phase 4): text targets carrying P5's sample strings — each a box of
// its colour with the string drawn on it in black, the box the target: a button whose label is the string (so every
// tree reads the string as its label), identified lab.<cell>.<tag>, its frame reported as `<tag>` and `<tag>.box` (the
// one `drawn` is measured over: scripts/truth/capture-run.ts). A tap on it logs the target's `tap`.
//
// - `text-sample`: ten open strings down the screen, 380×64 pt, the string 16 pt.
// - `text-under-bar`: S centred in the status band (the whole width, 20 pt), W in the open, P under a button pinned
//   16 pt above the home indicator's band (chrome `pinned`, Bars.swift's PinnedBar) — P's top 8 pt above the button,
//   its centre and its string under it (calibration.json #22's OCR half). Reports the window's insets.
// - `text-nav-cut` is Android's (gesture navigation): the capture skips it here.

struct TextScreen: View {
    @EnvironmentObject var lab: Lab
    let cell: Cell
    @State private var insets: UIEdgeInsets?

    var body: some View {
        let screen = UIScreen.main.bounds.size
        ZStack(alignment: .topLeading) {
            Color.white
            switch cell.id {
            case "text-sample":
                ForEach(cell.targets, id: \.tag) { t in
                    TextTarget(cell: cell, target: t, size: CGSize(width: 380, height: 64), font: 16)
                        .position(x: screen.width / 2, y: 96 + CGFloat(t.slot) * 72)
                }
            case "text-under-bar":
                if let insets { TextUnderBar(cell: cell, screen: screen, insets: insets) }
            default:
                UnbuiltCell(cell: cell)
            }
        }
        .frame(width: screen.width, height: screen.height)
        .ignoresSafeArea()
        .task {
            try? await Task.sleep(for: .milliseconds(300))
            insets = windowInsets() ?? .zero
            lab.safeArea()
            try? await Task.sleep(for: .milliseconds(800))
            lab.settled()
        }
    }
}

/// One text target: its box with the string on it, a button whose label is the string.
struct TextTarget: View {
    @EnvironmentObject var lab: Lab
    let cell: Cell
    let target: Target
    let size: CGSize
    let font: CGFloat

    var body: some View {
        Button {
            lab.event("tap", target.tag)
        } label: {
            ZStack {
                Rectangle().fill(Color(hex: target.color))
                Text(target.text ?? "")
                    .font(.system(size: font))
                    .foregroundStyle(.black)
                    .lineLimit(1)
            }
        }
        .buttonStyle(Flat())
        .frame(width: size.width, height: size.height)
        .accessibilityIdentifier("lab.\(cell.id).\(target.tag)")
        .reportFrame(target.tag, to: lab)
        .reportFrame("\(target.tag).box", to: lab)
    }
}

/// `text-under-bar`: S in the status band, W in the open, P under the pinned `Continue`.
struct TextUnderBar: View {
    @EnvironmentObject var lab: Lab
    let cell: Cell
    let screen: CGSize
    let insets: UIEdgeInsets

    var body: some View {
        let x = screen.width / 2
        let buttonTop = screen.height - insets.bottom - 16 - 56
        let box = CGSize(width: 300, height: 64)
        if let s = cell.targets.first(where: { $0.tag == "S" }) {
            TextTarget(cell: cell, target: s, size: CGSize(width: screen.width, height: 20), font: 13).position(x: x, y: insets.top / 2)
        }
        if let w = cell.targets.first(where: { $0.tag == "W" }) {
            TextTarget(cell: cell, target: w, size: box, font: 16).position(x: x, y: screen.height / 2 - 120)
        }
        if let p = cell.targets.first(where: { $0.tag == "P" }) {
            TextTarget(cell: cell, target: p, size: box, font: 16).position(x: x, y: buttonTop - 8 + box.height / 2)
        }
        Button {
            lab.event("button", "pinned.continue")
        } label: {
            RoundedRectangle(cornerRadius: 12).fill(Color(hex: "#263238"))
                .overlay(Text("Continue").foregroundStyle(.white))
        }
        .buttonStyle(Flat())
        .frame(width: screen.width - 48, height: 56)
        .accessibilityIdentifier("lab.\(cell.id).continue")
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { lab.chrome("pinned", $0) }
        .position(x: x, y: buttonTop + 28)
    }
}
