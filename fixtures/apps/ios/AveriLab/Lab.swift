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
    /// The title drawn as the navigation bar's principal item with this identifier; a tap on it ends the editing.
    let titleId: String?
    /// Each title floats inside its field's component, overlapping the field's top (FE2), not stacked above it.
    let floatingTitles: Bool?
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
    /// The field's own identifier, else lab.<cell>.<tag> — a component id shared by every field and its title (FE2).
    let fieldId: String?
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
    /// A text target (B5's own-parts): this text drawn on its coloured control, the control's box `<tag>.box`.
    let text: String?
    /// A label target (own-parts' `I`): an icon button whose accessibility label this is, on its box `<tag>.box`.
    let label: String?

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
    /// "touch" (a touch began in one of the app's windows, `tag` "x,y" in screen points — the probe's positive
    /// control).
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
    // Phase 3's geometry (scripts/truth/truth.ts#geometryOf, scripts/truth/schema.ts#LabState), written only by the
    // cells that measure it; nil (absent from the file) on every other cell.
    var safeArea: Insets?
    var scrollViews: [String: Frame]?
    var chrome: [String: Frame]?
    // Phase 5's live oracle (scripts/truth/live.ts): each scroll view's content offset now, and each stroke it took —
    // nil (absent from the file) on a cell with no scroll view that reports them.
    var offsets: [String: Double]?
    var strokes: [Stroke]?
}

/// One stroke a scroll view took (scripts/truth/schema.ts#Stroke): its content offset (points, 0 its content's top)
/// when it left rest and when it came to rest again — a drag and the fling after it are one stroke.
struct Stroke: Codable {
    let view: String
    let from: Double
    let to: Double
    let at: Double
}

/// The window's safe-area insets, in points — the system bands (scripts/truth/schema.ts#Insets).
struct Insets: Codable, Equatable {
    let top: Double
    let left: Double
    let bottom: Double
    let right: Double

    init(_ e: UIEdgeInsets) {
        top = e.top; left = e.left; bottom = e.bottom; right = e.right
    }
}

/// The key window's safe-area insets — the status band on top, the home indicator's at the bottom; nil while no window
/// is key. The one reader: Lab.safeArea reports them, a cell laid out against the bands (Bars.swift) reads them.
@MainActor func windowInsets() -> UIEdgeInsets? {
    UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).first { $0.isKeyWindow }?.safeAreaInsets
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
        state.safeArea = nil
        state.scrollViews = nil
        state.chrome = nil
        state.offsets = nil
        state.strokes = nil
        strokeFrom = [:]
        rest = [:]
        moving = [:]
        write()
    }

    // --- phase 3's geometry: what a target's measured geometry is measured against (truth.ts#geometryOf) ---

    /// The key window's safe-area insets (windowInsets): iOS's status bar and home indicator.
    func safeArea() {
        guard let e = windowInsets() else { return }
        let i = Insets(e)
        guard state.safeArea != i else { return }
        state.safeArea = i
        write()
    }

    /// A scroll view's clip on the screen (global frame), by the id the catalog's targets name (`scrollView`): what of
    /// its content can show.
    func scrollView(_ id: String, _ rect: CGRect) {
        let f = Frame(rect)
        guard state.scrollViews?[id] != f else { return }
        state.scrollViews = (state.scrollViews ?? [:]).merging([id: f]) { $1 }
        write()
    }

    /// App UI drawn over content (a sticky header, a bar), by name, its global frame.
    func chrome(_ name: String, _ rect: CGRect) {
        let f = Frame(rect)
        guard state.chrome?[name] != f else { return }
        state.chrome = (state.chrome ?? [:]).merging([name: f]) { $1 }
        write()
    }

    // --- phase 5's live oracle: where each scroll view is, and each stroke it took ---

    /// The content offset each moving scroll view had when it left rest.
    private var strokeFrom: [String: Double] = [:]
    /// Where each scroll view last came to rest (or was put, not moving): a stroke's `from` — the offset may already
    /// have moved when the phase leaves idle.
    private var rest: [String: Double] = [:]

    /// A scroll view's content offset now (points down its content, 0 its top), by its id.
    func offset(_ id: String, _ y: Double) {
        if strokeFrom[id] == nil && moving[id] != true { rest[id] = y }
        guard state.offsets?[id] != y else { return }
        state.offsets = (state.offsets ?? [:]).merging([id: y]) { $1 }
        write()
    }

    private var moving: [String: Bool] = [:]

    /// A scroll view left rest (`moving`) or came to rest at `y`: on rest, the stroke from where it last rested to here.
    func scrolling(_ id: String, _ isMoving: Bool, _ y: Double) {
        moving[id] = isMoving
        if isMoving {
            if strokeFrom[id] == nil { strokeFrom[id] = rest[id] ?? y }
            return
        }
        rest[id] = y
        offset(id, y)
        guard let from = strokeFrom.removeValue(forKey: id) else { return }
        state.strokes = (state.strokes ?? []) + [Stroke(view: id, from: from, to: y, at: Date().timeIntervalSince1970)]
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

extension View {
    /// Reports this SwiftUI scroll view's content offset and its strokes to the lab under `id` (Lab.offset,
    /// Lab.scrolling): the live golden's oracle of which scroll view a stroke moved, and which way. `axis`: the one it
    /// scrolls along — a horizontal one (carousel-in-list's carousel) reports its offset across its content from its
    /// leading edge.
    func labScroll(_ id: String, _ lab: Lab, axis: Axis = .vertical) -> some View {
        let along = { (g: ScrollGeometry) in Double(axis == .vertical ? g.contentOffset.y + g.contentInsets.top : g.contentOffset.x + g.contentInsets.leading) }
        return self
            .onScrollGeometryChange(for: Double.self) { along($0) } action: { _, y in lab.offset(id, y) }
            .onScrollPhaseChange { _, phase, context in
                lab.scrolling(id, phase != .idle, along(context.geometry))
            }
    }
}

extension Color {
    init(hex: String) {
        let v = UInt32(hex.dropFirst(), radix: 16) ?? 0
        self.init(.sRGB, red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }
}
