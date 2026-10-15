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
    /// base, presented, forms, edges, bars, false-covers — CellRouter (AveriLabApp.swift) routes by it.
    let family: String?
    let layer: String
    let targets: [Target]
    /// A form cell (scripts/truth/schema.ts#CatalogForm): fields, a submit, maybe a picker — no coloured targets.
    let form: FormSpec?
}

struct Message: Codable, Equatable {
    let text: String
    let id: String
}

struct FormSpec: Decodable {
    let title: String
    let fields: [FieldSpec]
    let submit: SubmitSpec
    let screenError: Message?
    let submitOnAppear: Bool?
    let focus: String?
    let picker: PickerSpec?
}

struct FieldSpec: Decodable, Identifiable {
    let tag: String
    /// text, email, iban, amount, pin, country.
    let kind: String
    let title: String
    let titleId: String?
    let placeholder: String?
    let prefill: String?
    let error: Message?

    var id: String { tag }
}

struct SubmitSpec: Decodable {
    let tag: String
    let title: String
    let pinned: Bool?
}

struct PickerSpec: Decodable {
    let field: String
    let title: String
    let open: Bool?
    let rows: [PickerRow]
    let probe: [String]?
}

struct PickerRow: Decodable, Identifiable {
    let code: String
    let name: String

    var id: String { code }
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
    /// "tap" (a target's action fired), "dismissed" (a layer went away), "button" (a layer's own button); on a form
    /// "focus" (the field `tag` took the focus, "" none), "submit" (`tag` valid / invalid), "select" (a picker row);
    /// "touch" (a touch began in one of the app's windows, `tag` "x,y" in screen points — the probe's positive control).
    let kind: String
    let tag: String
    let at: Double
}

/// One field as the model holds it — the oracle a fill is judged by, not what any tree reports.
struct FieldState: Codable, Equatable {
    var value: String
    var focused: Bool
    var error: Message?

    private enum CodingKeys: String, CodingKey { case value, focused, error }

    init(value: String, focused: Bool, error: Message?) {
        self.value = value; self.focused = focused; self.error = error
    }

    /// `error` written as null when none is shown (the synthesized encoder would leave the key out).
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(value, forKey: .value)
        try c.encode(focused, forKey: .focused)
        try c.encode(error, forKey: .error)
    }
}

struct KeyboardState: Codable, Equatable {
    /// UIKeyboardFrameEndUserInfoKey: points, screen coordinates.
    let frame: Frame
    let visible: Bool
    /// The field focused when the frame changed — the one the keyboard serves.
    let field: String?
}

struct Submit: Codable {
    let at: Double
    let valid: Bool
    let values: [String: String]
}

struct LabState: Codable {
    var cell: String
    var ready: Bool
    var screen: Frame
    var scale: Double
    var frames: [String: Frame]
    var events: [LabEvent]
    // A form cell's oracle; nil (absent from the file) on the coloured-target cells.
    var fields: [String: FieldState]?
    var focus: String?
    var keyboard: KeyboardState?
    var submits: [Submit]?
}

@MainActor
final class Lab: ObservableObject {
    @Published var cell: Cell?
    private var state: LabState
    private let file: URL

    /// The lab the touch recorder reports to (TouchRecorder): one per process.
    static weak var current: Lab?

    init() {
        file = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("lab-state.json")
        let screen = UIScreen.main
        state = LabState(cell: "", ready: false, screen: Frame(screen.bounds), scale: Double(screen.scale), frames: [:], events: [])
        Lab.current = self
        TouchRecorder.install()
        if let id = UserDefaults.standard.string(forKey: "cell") { show(id) } else { write() }
    }

    /// A touch began at `p` (screen points): logged, so a probe tap that never reached the app reads as undelivered.
    func touched(_ p: CGPoint) {
        event("touch", String(format: "%.1f,%.1f", p.x, p.y))
    }

    /// A fresh state for `id`: what the last cell wrote is gone, so the capture script never reads it as this one's.
    func show(_ id: String) {
        cell = Catalog.bundled.cells.first { $0.id == id }
        state.cell = cell?.id ?? "unknown:\(id)"
        state.ready = false
        state.frames = [:]
        state.events = []
        state.fields = cell?.form == nil ? nil : [:]
        state.focus = nil
        state.keyboard = nil
        state.submits = cell?.form == nil ? nil : []
        write()
    }

    // --- the form oracle ---

    func field(_ tag: String, _ f: FieldState) {
        guard state.fields?[tag] != f else { return }
        state.fields?[tag] = f
        write()
    }

    func focused(_ tag: String?) {
        guard state.focus != tag else { return }
        state.focus = tag
        state.events.append(LabEvent(kind: "focus", tag: tag ?? "", at: Date().timeIntervalSince1970))
        write()
    }

    /// From `keyboardWillChangeFrame` / `keyboardWillHide`: the end frame, and whether any of it lies on the screen.
    func keyboard(_ end: CGRect) {
        let k = KeyboardState(frame: Frame(end), visible: end.minY < state.screen.height && end.height > 0, field: state.focus)
        guard state.keyboard != k else { return }
        state.keyboard = k
        write()
    }

    func submit(valid: Bool, values: [String: String]) {
        let now = Date().timeIntervalSince1970
        state.submits?.append(Submit(at: now, valid: valid, values: values))
        state.events.append(LabEvent(kind: "submit", tag: valid ? "valid" : "invalid", at: now))
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

/// Every touch any window of the app receives, before anything handles it: UIApplication.sendEvent, swapped once for
/// a version that logs each touch's start and then sends the event on unchanged. A sheet, an alert and the keyboard's
/// host window are all the app's windows: a tap on a key is logged too (the form-keyboard probes of vs, ks, ss and
/// note hold their touch), so the truth exempts no keyboard from the positive control on iOS (truth.ts).
enum TouchRecorder {
    @MainActor static func install() {
        guard !installed,
              let original = class_getInstanceMethod(UIApplication.self, #selector(UIApplication.sendEvent(_:))),
              let recording = class_getInstanceMethod(UIApplication.self, #selector(UIApplication.lab_sendEvent(_:)))
        else { return }
        method_exchangeImplementations(original, recording)
        installed = true
    }

    @MainActor private static var installed = false
}

extension UIApplication {
    /// After TouchRecorder.install this IS sendEvent, and `lab_sendEvent` the original.
    @objc func lab_sendEvent(_ event: UIEvent) {
        if event.type == .touches {
            for touch in event.allTouches ?? [] where touch.phase == .began {
                guard let window = touch.window else { continue }
                Lab.current?.touched(window.convert(touch.location(in: window), to: window.screen.coordinateSpace))
            }
        }
        lab_sendEvent(event)
    }
}

extension Color {
    init(hex: String) {
        let v = UInt32(hex.dropFirst(), radix: 16) ?? 0
        self.init(.sRGB, red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }
}
