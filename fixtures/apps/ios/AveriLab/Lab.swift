import SwiftUI
import UIKit

// The lab app's model: the cell catalog it bundles (fixtures/apps/cells.json) and the state file it writes for the
// capture script (scripts/truth/schema.ts#LabState) — the cell on screen, each target's frame as the app lays it out,
// whether the screen has settled, and every event a target or a layer received.

struct Catalog: Decodable {
    let version: Int
    let cells: [Cell]

    static let bundled: Catalog = {
        guard let url = Bundle.main.url(forResource: "cells", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let catalog = try? JSONDecoder().decode(Catalog.self, from: data)
        else { fatalError("cells.json is missing from the bundle or does not decode") }
        return catalog
    }()
}

struct Cell: Decodable, Identifiable {
    let id: String
    let layer: String
    let targets: [Target]
}

struct Target: Decodable {
    let tag: String
    let color: String
    let slot: Int
    /// "layer": the target lies on the cell's layer (inside the sheet), not on the screen beneath it.
    let `in`: String?
    let declared: String

    var onLayer: Bool { self.in == "layer" }
}

struct Frame: Codable, Equatable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double

    init(_ r: CGRect) {
        x = r.origin.x; y = r.origin.y; width = r.size.width; height = r.size.height
    }
}

struct LabEvent: Codable {
    /// "tap" (a target's action fired), "dismissed" (a layer went away), "button" (a layer's own button).
    let kind: String
    let tag: String
    let at: Double
}

struct LabState: Codable {
    var cell: String
    var ready: Bool
    var screen: Frame
    var scale: Double
    var frames: [String: Frame]
    var events: [LabEvent]
}

@MainActor
final class Lab: ObservableObject {
    @Published var cell: Cell?
    private var state: LabState
    private let file: URL

    init() {
        file = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("lab-state.json")
        let screen = UIScreen.main
        state = LabState(cell: "", ready: false, screen: Frame(screen.bounds), scale: Double(screen.scale), frames: [:], events: [])
        if let id = UserDefaults.standard.string(forKey: "cell") { show(id) } else { write() }
    }

    /// A fresh state for `id`: what the last cell wrote is gone, so the capture script never reads it as this one's.
    func show(_ id: String) {
        cell = Catalog.bundled.cells.first { $0.id == id }
        state.cell = cell?.id ?? "unknown:\(id)"
        state.ready = false
        state.frames = [:]
        state.events = []
        write()
    }

    func frame(_ tag: String, _ rect: CGRect) {
        let f = Frame(rect)
        guard state.frames[tag] != f else { return }
        state.frames[tag] = f
        write()
    }

    func settled() {
        state.ready = true
        write()
    }

    func event(_ kind: String, _ tag: String) {
        state.events.append(LabEvent(kind: kind, tag: tag, at: Date().timeIntervalSince1970))
        write()
    }

    private func write() {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(state) else { return }
        try? data.write(to: file, options: .atomic)
    }
}

extension Color {
    init(hex: String) {
        let v = UInt32(hex.dropFirst(), radix: 16) ?? 0
        self.init(.sRGB, red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }
}
