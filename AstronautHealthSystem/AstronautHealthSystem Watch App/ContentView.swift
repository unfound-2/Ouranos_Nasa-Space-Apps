import CoreMotion
import SwiftUI
import WatchKit

private let amber = Color(red: 1, green: 0.75, blue: 0.39)
private let muted = Color(red: 0.68, green: 0.70, blue: 0.66)

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("missionConsoleAddress") private var consoleAddress = ""
    @State private var addressDraft = ""
    @State private var editingAddress = false
    @State private var pairing: Pairing?
    @State private var paired = false
    @State private var pairingBusy = false
    @State private var showSharing = false
    @State private var shareReadings = false
    @State private var readHealth = false
    @State private var healthBusy = false
    @State private var mode: Mode?
    @State private var frames: [TelemetryFrame] = []
    @State private var latestSignal: ReviewSignal?
    @State private var outbox: [ReviewSignal] = []
    @State private var sessionMessage = ""
    @State private var status = ""
    @State private var delivery = ""
    @State private var watchReadings: [TelemetryFrame.Reading] = []
    @State private var motionReadings: [TelemetryFrame.Reading] = []
    @State private var motion = CMMotionManager()
    @State private var biometrics = WatchBiometrics()

    private enum Mode: String {
        case demo = "SIMULATED FEED"
        case onboard = "ONBOARD FEED"
        case watch = "WATCH SENSORS"
    }

    private struct Pairing: Decodable {
        let code: String
        let watchToken: String
        let codeExpiresAt: TimeInterval
        let consoleURL: URL?

        var formattedCode: String { code.prefix(5) + "-" + code.suffix(5) }
    }

    private struct PairingState: Decodable {
        let paired: Bool
    }

    private struct GatewayError: Error {
        let status: Int
    }

    private struct ConsoleHealth: Decodable {
        let service: String
    }

    private var gateway: URL? {
        if let saved = gatewayURL(consoleAddress) { return saved }
        #if targetEnvironment(simulator)
        if let override = gatewayURL(ProcessInfo.processInfo.environment["GRAVITYGUARD_GATEWAY_URL"]) {
            return override
        }
        #endif
        let configured = gatewayURL(Bundle.main.object(forInfoDictionaryKey: "GravityGuardGatewayURL") as? String)
        #if targetEnvironment(simulator)
        return configured ?? URL(string: "http://127.0.0.1:4317")
        #else
        return configured
        #endif
    }

    private func gatewayURL(_ value: String?) -> URL? {
        guard let value, let parts = URLComponents(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
              let host = parts.host, !host.isEmpty,
              parts.scheme == "http" || parts.scheme == "https",
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/" else { return nil }
        return parts.url
    }

    private func pairingLink(for pairing: Pairing) -> URL? {
        guard let origin = pairing.consoleURL ?? gateway,
              var components = URLComponents(url: origin, resolvingAgainstBaseURL: false) else { return nil }
        // Older mission servers don't include their local browser address.
        components.host = "127.0.0.1"
        components.fragment = "pair=\(pairing.code)"
        return components.url
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 9) {
                Text("GRAVITYGUARD")
                    .font(.system(.caption, design: .monospaced, weight: .bold))
                    .foregroundStyle(amber)
                    .accessibilityAddTraits(.isHeader)
                Rectangle().fill(amber.opacity(0.55)).frame(height: 1).accessibilityHidden(true)
                if let mode { monitoring(mode) } else { home }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
        }
        .id(mode)
        .background(Color(red: 0.065, green: 0.075, blue: 0.065).ignoresSafeArea())
        .foregroundStyle(.white)
        .sheet(isPresented: $editingAddress) {
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Console address").font(.headline)
                    TextField("http://computer.local:4317", text: $addressDraft)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button("Save address") {
                        guard let url = gatewayURL(addressDraft) else { return }
                        pairing = nil
                        consoleAddress = url.absoluteString
                        sessionMessage = ""
                        editingAddress = false
                    }
                    .disabled(gatewayURL(addressDraft) == nil)
                    Button("Use default address") {
                        pairing = nil
                        consoleAddress = ""
                        sessionMessage = ""
                        editingAddress = false
                    }
                }
                .padding()
            }
        }
        .confirmationDialog("Share watch measurements with the paired crew console?", isPresented: $showSharing) {
            Button("Share with console") { shareReadings = true }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Available watch measurements will be sent during Watch Sensors and Onboard monitoring.")
        }
        .task(id: scenePhase == .active ? pairing?.watchToken : nil) {
            guard scenePhase == .active, let pairing else { return }
            await observePairing(pairing)
        }
        .task(id: scenePhase == .active ? mode : nil) {
            guard scenePhase == .active, let mode else { return }
            await monitor(mode)
        }
        .task(id: scenePhase == .active && mode != nil && mode != .demo && readHealth) {
            guard scenePhase == .active, let mode, mode != .demo, readHealth else { return }
            while !Task.isCancelled {
                let values = await biometrics.read()
                guard !Task.isCancelled else { return }
                watchReadings = values
                try? await Task.sleep(for: .seconds(20))
            }
        }
        .onChange(of: scenePhase) {
            if scenePhase != .active {
                frames = []
                motionReadings = []
                status = "Monitoring paused"
            }
        }
    }

    private var home: some View {
        Group {
            Text("Crew telemetry").font(.headline)
            if paired {
                Text("Console connected").font(.footnote).foregroundStyle(amber)
                control("Disconnect console") { Task { await disconnect() } }
                    .disabled(pairingBusy)
            } else if let pairing, Date.now.timeIntervalSince1970 < pairing.codeExpiresAt {
                Text(pairing.formattedCode)
                    .font(.system(.headline, design: .monospaced, weight: .bold))
                    .foregroundStyle(amber)
                if let link = pairingLink(for: pairing) {
                    ShareLink(item: link) {
                        Text("Share pairing link")
                            .font(.system(.footnote, design: .monospaced, weight: .semibold))
                            .foregroundStyle(.black)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .background(amber)
                    }
                    .buttonStyle(.plain)
                    Text("Open on the console computer: \(link.host ?? "localhost"):\(link.port ?? 80).").font(.footnote)
                }
                control("Get a new code") { Task { await createPairing() } }
                    .disabled(pairingBusy)
            } else {
                control(pairingBusy ? "Generating code…" : "Get pairing code", primary: true) {
                    Task { await createPairing() }
                }
                .disabled(pairingBusy)
            }
            if !paired {
                control("Set console address") {
                    addressDraft = gateway?.absoluteString ?? ""
                    editingAddress = true
                }
                .disabled(pairingBusy)
                if let gateway {
                    Text(gateway.absoluteString).font(.caption2).foregroundStyle(muted)
                }
            }
            if !sessionMessage.isEmpty {
                Text(sessionMessage).font(.footnote).foregroundStyle(muted)
            }
            control("Connect onboard") {
                if paired { start(.onboard) } else { sessionMessage = "Pair the crew console first." }
            }
            control("Watch sensors") { start(.watch) }
            control("Run simulation") { start(.demo) }
            control(readHealth ? "Turn off health readings" : "Enable health readings") {
                if readHealth {
                    readHealth = false
                    watchReadings = []
                } else {
                    Task { await enableHealth() }
                }
            }
            .disabled(healthBusy)
            if paired {
                control(shareReadings ? "Keep watch readings local" : "Share watch readings") {
                    if shareReadings {
                        shareReadings = false
                        outbox = outbox.map { $0.withoutWatchContext() }
                        if let token = pairing?.watchToken {
                            Task {
                                do {
                                    _ = try await request("api/watch", method: "DELETE", token: token)
                                } catch {
                                    sessionMessage = "Sharing off. Console unavailable to clear its last snapshot."
                                }
                            }
                        }
                    } else {
                        showSharing = true
                    }
                }
            }
        }
    }

    private func monitoring(_ mode: Mode) -> some View {
        Group {
            Text(mode.rawValue).font(.system(.caption2, design: .monospaced)).foregroundStyle(amber)
            Text(status).font(.footnote).foregroundStyle(muted)
            if let latestSignal {
                Text("Review signal").font(.headline).foregroundStyle(amber)
                Text(latestSignal.evidence.joined(separator: " · ")).font(.footnote)
                Text(delivery).font(.caption2).foregroundStyle(muted)
                Text(latestSignal.action).font(.footnote)
            }
            control("Stop monitoring") { self.mode = nil }
            ForEach(frames, id: \.source) { frame in
                Text(frame.source).font(.headline)
                readings(frame.readings)
            }
            if mode != .demo {
                Text("Apple Watch").font(.headline)
                if let difference = pulseDifference() {
                    Text("Pulse difference \(difference, format: .number.precision(.fractionLength(0))) bpm")
                        .font(.footnote).foregroundStyle(amber)
                }
                if readHealth && watchReadings.isEmpty {
                    Text("Waiting for permitted HealthKit samples.").font(.footnote).foregroundStyle(muted)
                }
                if motionReadings.isEmpty {
                    Text("Watch motion unavailable.").font(.footnote).foregroundStyle(muted)
                }
                readings(motionReadings + watchReadings)
            }
        }
    }

    private func readings(_ readings: [TelemetryFrame.Reading]) -> some View {
        ForEach(readings, id: \.metric) { reading in
            VStack(alignment: .leading, spacing: 2) {
                Text(reading.metric).font(.caption2).foregroundStyle(muted)
                if reading.quality == "valid" {
                    Text("\(reading.value.formatted(.number.precision(.fractionLength(0...2)))) \(reading.unit)")
                        .font(.system(.title3, design: .monospaced, weight: .semibold))
                    if let measuredAt = reading.measuredAt {
                        Text(Date(timeIntervalSince1970: measuredAt), format: .dateTime.month().day().hour().minute())
                            .font(.caption2).foregroundStyle(muted)
                    }
                    if reading.status != "nominal" {
                        Text(reading.status.capitalized).font(.caption2).foregroundStyle(amber)
                    }
                } else {
                    Text("Unreliable reading").font(.footnote).foregroundStyle(amber)
                }
            }
        }
    }

    private func control(_ label: String, primary: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(.footnote, design: .monospaced, weight: .semibold))
                .foregroundStyle(primary ? .black : .white)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .padding(.horizontal, 9)
                .background(primary ? amber : .white.opacity(0.08))
                .overlay { Rectangle().strokeBorder(amber.opacity(primary ? 0 : 0.28)) }
        }
        .buttonStyle(.plain)
    }

    private func start(_ selection: Mode) {
        frames = []
        motionReadings = []
        watchReadings = []
        latestSignal = nil
        delivery = ""
        status = "Waiting for readings"
        mode = selection
    }

    @MainActor
    private func createPairing() async {
        guard !pairingBusy else { return }
        guard let gateway else {
            sessionMessage = "Enter the address shown under Watch integration on the dashboard."
            return
        }
        pairingBusy = true
        sessionMessage = ""
        defer { pairingBusy = false }
        do {
            guard let healthData = try? await request("api/v1/health"),
                  let health = try? JSONDecoder().decode(ConsoleHealth.self, from: healthData),
                  health.service == "gravityguard-mission-computer" else {
                sessionMessage = "Mission Dashboard unavailable at this address. Check the address and start the console."
                return
            }
            if let previous = pairing {
                pairing = nil
                _ = try? await request("api/device", method: "DELETE", token: previous.watchToken)
            }
            let data = try await request("api/pairing", method: "POST")
            pairing = try JSONDecoder().decode(Pairing.self, from: data)
        } catch let error as GatewayError {
            sessionMessage = "Crew Console returned HTTP \(error.status)."
        } catch let error as URLError where error.code == .appTransportSecurityRequiresSecureConnection {
            sessionMessage = "Use an HTTPS or local network console address."
        } catch is DecodingError {
            sessionMessage = "Crew Console returned an invalid pairing response."
        } catch {
            sessionMessage = "Can't reach \(gateway.host ?? "Crew Console"):\(gateway.port ?? (gateway.scheme == "https" ? 443 : 80))."
        }
    }

    @MainActor
    private func observePairing(_ pairing: Pairing) async {
        while !Task.isCancelled {
            do {
                let data = try await request("api/device", token: pairing.watchToken)
                try Task.checkCancellation()
                paired = try JSONDecoder().decode(PairingState.self, from: data).paired
                if !paired && Date.now.timeIntervalSince1970 >= pairing.codeExpiresAt {
                    sessionMessage = "Code expired. Generate another."
                    return
                }
                try await Task.sleep(for: .seconds(paired ? 8 : 2))
            } catch let error as GatewayError where error.status == 401 {
                guard !Task.isCancelled, self.pairing?.watchToken == pairing.watchToken else { return }
                self.pairing = nil
                paired = false
                shareReadings = false
                outbox = []
                sessionMessage = "Pairing expired. Generate a new code."
                if mode == .onboard { mode = nil }
                return
            } catch {
                try? await Task.sleep(for: .seconds(2))
            }
        }
    }

    @MainActor
    private func disconnect() async {
        guard !pairingBusy, let pairing else { return }
        pairingBusy = true
        defer { pairingBusy = false }
        do {
            _ = try await request("api/device", method: "DELETE", token: pairing.watchToken)
        } catch let error as GatewayError where error.status == 401 {
            // The gateway already closed this session.
        } catch {
            sessionMessage = "Console unreachable. Try disconnecting again."
            return
        }
        self.pairing = nil
        paired = false
        shareReadings = false
        outbox = []
        sessionMessage = "Console disconnected."
    }

    @MainActor
    private func enableHealth() async {
        guard !healthBusy else { return }
        healthBusy = true
        defer { healthBusy = false }
        do {
            try await biometrics.authorize()
            readHealth = true
            sessionMessage = "Health readings enabled where permitted."
        } catch {
            sessionMessage = "HealthKit access unavailable."
        }
    }

    @MainActor
    private func monitor(_ mode: Mode) async {
        if mode != .demo, motion.isDeviceMotionAvailable {
            motion.deviceMotionUpdateInterval = 0.1
            motion.startDeviceMotionUpdates()
        }
        defer { motion.stopDeviceMotionUpdates() }

        var rules: [String: SignalRules] = [:]
        var step = 0
        while !Task.isCancelled {
            let token = paired ? pairing?.watchToken : nil
            let now = Date.now
            motionReadings = readMotion(at: now)
            do {
                let next: [TelemetryFrame]
                switch mode {
                case .demo:
                    next = [demoFrame(step: step)]
                case .watch:
                    next = []
                case .onboard:
                    guard let token else { return }
                    let data = try await request("api/telemetry", token: token)
                    next = try JSONDecoder().decode([TelemetryFrame].self, from: data)
                        .filter { $0.version == 1 && !$0.simulated && $0.isFresh(at: .now) }
                }
                try Task.checkCancellation()
                frames = next
                status = mode == .watch ? "On-device monitoring" :
                    next.isEmpty ? "Waiting for fresh onboard data" : "Receiving telemetry"
                for frame in next {
                    let wrist = motionReadings.first?.value
                    let pulse = watchReadings.first { $0.metric == "Heart rate" }
                    if let signal = rules[frame.source, default: SignalRules()]
                        .evaluate(frame, wristMotionG: wrist, watchPulse: pulse, now: .now) {
                        latestSignal = signal
                        WKInterfaceDevice.current().play(.notification)
                        if token != nil {
                            outbox.append(shareReadings ? signal : signal.withoutWatchContext())
                            if outbox.count > 100 { outbox.removeFirst() }
                            delivery = "Queued for console"
                        } else {
                            delivery = "Watch only"
                        }
                    }
                }
                if let token, mode == .demo, let demo = next.first {
                    try? await publish(demo, token: token)
                } else if let token, shareReadings, step.isMultiple(of: 5) {
                    let values = motionReadings + watchReadings
                    if !values.isEmpty {
                        let snapshot = TelemetryFrame(version: 1, source: "Apple Watch", observedAt: now.timeIntervalSince1970,
                                                      simulated: false, readings: values)
                        try? await publish(snapshot, token: token)
                    }
                }
            } catch {
                guard !Task.isCancelled else { return }
                status = "Feed unavailable"
                frames = []
            }
            if let token { await flushSignals(token: token) }
            step += 1
            try? await Task.sleep(for: .seconds(2))
        }
    }

    private func readMotion(at now: Date) -> [TelemetryFrame.Reading] {
        guard let data = motion.deviceMotion,
              abs(ProcessInfo.processInfo.systemUptime - data.timestamp) < 2 else { return [] }
        let a = data.userAcceleration
        let r = data.rotationRate
        return [
            .init(metric: "Wrist motion", value: sqrt(a.x * a.x + a.y * a.y + a.z * a.z),
                  unit: "g", quality: "valid", status: "nominal", measuredAt: now.timeIntervalSince1970),
            .init(metric: "Wrist rotation", value: sqrt(r.x * r.x + r.y * r.y + r.z * r.z),
                  unit: "rad/s", quality: "valid", status: "nominal", measuredAt: now.timeIntervalSince1970)
        ]
    }

    private func pulseDifference() -> Double? {
        let now = Date.now.timeIntervalSince1970
        guard let watch = watchReadings.first(where: { $0.metric == "Heart rate" && $0.isRecent(at: now, window: 15) }),
              let onboard = frames.lazy
                .filter({ $0.isFresh(at: Date(timeIntervalSince1970: now)) })
                .flatMap(\.readings)
                .first(where: { $0.metric.lowercased() == "heart rate" && $0.quality == "valid" &&
                    $0.unit.lowercased() == "bpm" && ($0.measuredAt == nil || $0.isRecent(at: now, window: 15)) }) else {
            return nil
        }
        return abs(watch.value - onboard.value)
    }

    private func publish(_ frame: TelemetryFrame, token: String) async throws {
        _ = try await request("api/watch", method: "POST", token: token, body: JSONEncoder().encode(frame))
    }

    @MainActor
    private func flushSignals(token: String) async {
        guard !Task.isCancelled, let signal = outbox.first else { return }
        do {
            _ = try await request("api/signals", method: "POST", token: token, body: JSONEncoder().encode(signal))
            try Task.checkCancellation()
            outbox.removeAll { $0.id == signal.id }
            if latestSignal?.id == signal.id { delivery = "Delivered to console" }
        } catch {
            if !Task.isCancelled { delivery = "Console unreachable · queued" }
        }
    }

    private func request(_ path: String, method: String = "GET", token: String? = nil, body: Data? = nil) async throws -> Data {
        guard let gateway else { throw URLError(.badURL) }
        var request = URLRequest(url: gateway.appending(path: path), cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 4)
        request.httpMethod = method
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard (200..<300).contains(response.statusCode) else { throw GatewayError(status: response.statusCode) }
        return data
    }

    private func demoFrame(step: Int) -> TelemetryFrame {
        let elevated = (2...5).contains(step % 9)
        let status = elevated ? "review" : "nominal"
        return TelemetryFrame(
            version: 1, source: "ISS EMU / Bio-Monitor simulation", observedAt: Date.now.timeIntervalSince1970, simulated: true,
            readings: [
                .init(metric: "Heart rate", value: elevated ? 128 : 74, unit: "bpm", quality: "valid", status: status),
                .init(metric: "Respiration", value: elevated ? 27 : 16, unit: "/min", quality: "valid", status: status),
                .init(metric: "Blood oxygen", value: 98, unit: "%", quality: "valid", status: "nominal"),
                .init(metric: "Skin temperature", value: 34.1, unit: "°C", quality: "valid", status: "nominal"),
                .init(metric: "Systolic blood pressure", value: 118, unit: "mmHg", quality: "valid", status: "nominal"),
                .init(metric: "Tidal volume", value: 480, unit: "mL", quality: "valid", status: "nominal"),
                .init(metric: "Suit pressure", value: 4.3, unit: "psia", quality: "valid", status: "nominal"),
                .init(metric: "Primary oxygen tank pressure", value: 820, unit: "psia", quality: "valid", status: "nominal")
            ]
        )
    }
}

struct ContentView_Previews: PreviewProvider {
    static var previews: some View { ContentView() }
}
