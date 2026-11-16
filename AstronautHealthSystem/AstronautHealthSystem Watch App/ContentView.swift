import CoreMotion
import SwiftUI
import WatchKit

private let blue = Color(red: 0.61, green: 0.88, blue: 1)
private let muted = Color(white: 0.72)
private let controlSurface = Color(white: 0.14)
private let selectedSurface = Color(white: 0.25)

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("missionConsoleAddress") private var consoleAddress = ""
    @AppStorage("watchAlertBuzz") private var buzz = true
    @State private var page = Page.home
    @State private var trends: [String: [TrendPoint]] = [:]
    @State private var addressDraft = ""
    @State private var editingAddress = false
    @State private var showingNavigation = false
    @State private var showingReview = false
    @State private var selectedRegion: BodyRegion?
    @State private var pairing: Pairing?
    @State private var paired = false
    @State private var pairingBusy = false
    @State private var shareReadings = false
    @State private var readHealth = false
    @State private var healthBusy = false
    @State private var mode: Mode?
    @State private var frames: [TelemetryFrame] = []
    @State private var latestSignal: ReviewSignal?
    @State private var outbox: [ReviewSignal] = []
    @State private var sessionMessage = ""
    @State private var syncMessage = ""
    @State private var delivery = ""
    @State private var watchReadings: [TelemetryFrame.Reading] = []
    @State private var motionReadings: [TelemetryFrame.Reading] = []
    @State private var motion = CMMotionManager()
    @State private var biometrics = WatchBiometrics()
    @State private var dailyPlan: WatchDayPlan?
    @State private var planMessage = ""
    @State private var planBusy = false
    @State private var lastPlanRevision: Int?

    private struct WatchPlanTask: Decodable, Identifiable {
        let id: String
        let title: String
        let start: Int
        let duration: Int
        let done: Bool
        let deferred: Bool
        let note: String
    }
    private struct WatchDayPlan: Decodable {
        let date: String
        let revision: Int
        let tasks: [WatchPlanTask]
        let fatigue: String?
    }

    private enum Page: String, CaseIterable {
        case home = "Home"
        case analytics = "Analytics"
        case plan = "Daily plan"
        case settings = "Settings"
    }

    private enum Mode: String, CaseIterable {
        case watch = "Watch"
        case demo = "Sim"
    }

    private struct TrendPoint {
        let time: TimeInterval
        let value: Double
    }

    private struct Pairing: Decodable {
        let code: String
        let watchToken: String
        let codeExpiresAt: TimeInterval

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
        guard let value else { return nil }
        let address = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !address.isEmpty,
              var parts = URLComponents(string: address.contains("://") ? address : "https://\(address)"),
              let host = parts.host, !host.isEmpty,
              parts.scheme == "http" || parts.scheme == "https",
              parts.user == nil, parts.password == nil else { return nil }
        // Pair against the site's origin even when the user pastes a full page link.
        parts.path = ""
        parts.query = nil
        parts.fragment = nil
        return parts.url
    }

    var body: some View {
        Group {
            if editingAddress {
                addressPage
            } else if let region = selectedRegion, paired {
                regionPage(region)
            } else if paired {
                ZStack(alignment: .topTrailing) {
                    if showingNavigation {
                        navigationChoices
                    } else if page == .home {
                        bodyPage
                    } else {
                        VStack(spacing: 2) {
                            ScrollView {
                                VStack(alignment: .leading, spacing: 5) {
                                    if page == .analytics { analyticsPage } else if page == .plan { dailyPlanPage } else { settingsPage }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 6)
                            }
                            .id(page)
                            if page == .analytics { analyticsSelector }
                        }
                    }
                    navigation
                }
            } else {
                ScrollView { onboarding.padding(.horizontal, 7) }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black.ignoresSafeArea())
        .preferredColorScheme(.dark)
        .foregroundStyle(.white)
        .persistentSystemOverlays(.hidden)
        .task(id: scenePhase == .active ? pairing?.watchToken : nil) {
            guard scenePhase == .active, let pairing else { return }
            await observePairing(pairing)
        }
        .task(id: scenePhase == .active ? mode : nil) {
            guard scenePhase == .active, let mode else { return }
            await monitor(mode)
        }
        .task(id: scenePhase == .active && mode == .watch && readHealth && shareReadings && paired ? pairing?.watchToken : nil) {
            guard scenePhase == .active, mode == .watch, readHealth, shareReadings, paired,
                  let token = pairing?.watchToken else { return }
            await syncWatchReadings(token: token)
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
            }
        }
    }

    private var addressPage: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                pageTitle("Website address")
                TextField("https://your-site.vercel.app", text: $addressDraft)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .foregroundStyle(.white)
                    .padding(6)
                    .background(controlSurface, in: RoundedRectangle(cornerRadius: 8))
                control("Save address") {
                    guard let url = gatewayURL(addressDraft) else { return }
                    saveAddress(url.absoluteString)
                }
                .disabled(gatewayURL(addressDraft) == nil)
                control("Use default") { saveAddress("") }
                control("Cancel") { editingAddress = false }
            }
            .padding(.horizontal, 7)
        }
    }

    private func saveAddress(_ address: String) {
        pairing = nil
        consoleAddress = address
        sessionMessage = ""
        editingAddress = false
    }

    private func regionPage(_ region: BodyRegion) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 5) {
                HStack {
                    pageTitle(region.rawValue)
                    Spacer()
                    Button {
                        selectedRegion = nil
                    } label: {
                        Text("Close")
                            .font(.caption2)
                            .frame(minWidth: 42, minHeight: 36)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Close readings")
                }
                if mode == .demo {
                    smallLabel("Simulation")
                }
                let readings = currentReadings.filter { region.includes($0.metric) }
                if readings.isEmpty {
                    Text("No readings").font(.caption2).foregroundStyle(muted)
                } else {
                    metricGroup(currentSource, readings: readings)
                }
            }
            .padding(.horizontal, 7)
        }
    }

    private var onboarding: some View {
        VStack(spacing: 9) {
            VStack(spacing: 2) {
                Text("OURANOS")
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .tracking(3)
                    .accessibilityLabel("Ouranos")
                    .accessibilityAddTraits(.isHeader)
                Text("Crew health")
                    .font(.caption2)
                    .foregroundStyle(muted)
            }
            if let pairing, Date.now.timeIntervalSince1970 < pairing.codeExpiresAt {
                Text(pairing.formattedCode)
                    .font(.system(.headline, design: .monospaced, weight: .semibold))
                    .foregroundStyle(.white)
                Text("Enter this code on the dashboard.")
                    .font(.caption2)
                    .foregroundStyle(muted)
                control("Get a new code") { Task { await createPairing() } }
                    .disabled(pairingBusy)
            } else {
                control(pairingBusy ? "Generating code…" : "Get pairing code", primary: true) {
                    Task { await createPairing() }
                }
                .disabled(pairingBusy)
            }
            control("Set website address") {
                addressDraft = gateway?.absoluteString ?? ""
                editingAddress = true
            }
            .disabled(pairingBusy)
            if !sessionMessage.isEmpty {
                Text(sessionMessage).font(.footnote).foregroundStyle(muted)
            }
        }
        .padding(.top, 4)
    }

    private var navigation: some View {
        Button {
            showingNavigation.toggle()
        } label: {
            Image(systemName: "line.3.horizontal")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 23, height: 23)
                .background(controlSurface, in: Circle())
                .frame(width: 35, height: 32)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(showingNavigation ? "Close menu" : "Menu")
    }

    private var navigationChoices: some View {
        ScrollView {
            VStack(spacing: 5) {
                pageTitle("Menu")
                    .frame(minHeight: 32)
                ForEach(Page.allCases, id: \.self) { destination in
                    control(destination.rawValue) {
                        selectedRegion = nil
                        page = destination
                        showingNavigation = false
                    }
                }
            }
            .padding(.horizontal, 7)
        }
    }

    private var currentSource: String {
        mode == .demo ? frames.first?.source ?? "Simulation" : "Watch sensors"
    }

    private var currentReadings: [TelemetryFrame.Reading] {
        mode == .demo ? frames.first?.readings ?? [] : motionReadings + watchReadings
    }

    private var bodyPage: some View {
        VStack(spacing: 2) {
            if mode == .demo {
                smallLabel("Simulation")
            }
            BodyFigure(flagged: latestSignal != nil) { region in
                selectedRegion = region
            }
        }
        .padding(.bottom, 2)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var dailyPlanPage: some View {
        Group {
            pageTitle("Daily plan").frame(minHeight: 32)
            if let dailyPlan {
                Text("How are you feeling?").font(.caption2).foregroundStyle(muted)
                ForEach(["Rested", "Somewhat tired", "Very tired"], id: \.self) { label in
                    control(label) {
                        let value = label == "Rested" ? "rested" : label == "Very tired" ? "very" : "somewhat"
                        Task { await sendPlanAction(["type": "checkin", "fatigue": value]) }
                    }.disabled(planBusy)
                }
                let tasks = dailyPlan.tasks.filter { !$0.done && !$0.deferred }
                    .sorted { $0.start < $1.start }
                if let next = tasks.first {
                    Text(next.title).font(.footnote).padding(.top, 6)
                    Text(String(format: "%02d:%02d UTC · %d min", next.start / 60, next.start % 60, next.duration))
                        .font(.caption2).foregroundStyle(muted)
                    if !next.note.isEmpty { Text(next.note).font(.caption2).foregroundStyle(muted) }
                    control("Mark complete") { Task { await sendPlanAction(["type": "done", "taskId": next.id]) } }
                        .disabled(planBusy)
                    control("Running 15 min late") {
                        Task { await sendPlanAction(["type": "delay", "taskId": next.id, "minutes": 15]) }
                    }.disabled(planBusy)
                } else {
                    Text("No activities remaining.").font(.caption2).foregroundStyle(muted)
                }
            } else {
                Text("Create today’s plan on the console. It will appear here when connected.")
                    .font(.caption2).foregroundStyle(muted)
            }
            if !planMessage.isEmpty { Text(planMessage).font(.caption2).foregroundStyle(muted) }
        }
    }

    @MainActor
    private func refreshDailyPlan(token: String) async {
        guard !planBusy else { return }
        do {
            let data = try await request("api/planner", token: token)
            let next = try JSONDecoder().decode(WatchDayPlan?.self, from: data)
            let formatter = DateFormatter()
            formatter.dateFormat = "yyyy-MM-dd"
            formatter.timeZone = TimeZone(secondsFromGMT: 0)
            guard let next, next.date == formatter.string(from: .now) else {
                dailyPlan = nil
                lastPlanRevision = nil
                return
            }
            if let previous = lastPlanRevision, previous != next.revision, buzz {
                WKInterfaceDevice.current().play(.notification)
            }
            dailyPlan = next
            lastPlanRevision = next.revision
            planMessage = ""
        } catch {
            dailyPlan = nil
            planMessage = "Plan unavailable. Reconnecting…"
        }
    }

    @MainActor
    private func sendPlanAction(_ action: [String: Any]) async {
        guard !planBusy, let dailyPlan, let token = pairing?.watchToken else { return }
        planBusy = true
        defer { planBusy = false }
        do {
            let body = try JSONSerialization.data(withJSONObject: ["expectedRevision": dailyPlan.revision, "action": action])
            let data = try await request("api/planner-action", method: "POST", token: token, body: body)
            let next = try JSONDecoder().decode(WatchDayPlan.self, from: data)
            self.dailyPlan = next
            lastPlanRevision = next.revision
            planMessage = "Saved. Review any schedule changes on the console."
        } catch {
            planMessage = "Couldn’t save. Reconnect and try again."
        }
    }

    private var analyticsPage: some View {
        Group {
            pageTitle("Analytics").frame(minHeight: 32)
            if currentReadings.isEmpty {
                Text("No readings").font(.caption2).foregroundStyle(muted)
            } else {
                metricGroup(currentSource, readings: currentReadings)
            }
            if let latestSignal {
                Button("Review signal") { showingReview.toggle() }
                    .font(.footnote)
                if showingReview {
                    Text(latestSignal.evidence.joined(separator: " · ")).font(.caption2)
                    Text(latestSignal.action).font(.caption2)
                    if !delivery.isEmpty {
                        Text(delivery).font(.caption2).foregroundStyle(muted)
                    }
                }
            }
        }
    }

    private var analyticsSelector: some View {
        HStack(spacing: 3) {
            ForEach(Mode.allCases, id: \.self) { source in
                Button {
                    if mode != source { start(source) }
                } label: {
                    Text(source.rawValue)
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 11)
                        .frame(minHeight: 27)
                        .background(mode == source ? selectedSurface : .clear, in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(source == .watch ? "Watch sensors" : "Simulation")
                .accessibilityAddTraits(mode == source ? [.isSelected] : [])
            }
        }
        .padding(2)
        .frame(maxWidth: .infinity)
    }

    private func smallLabel(_ label: String) -> some View {
        Text(label)
            .font(.system(size: 9, weight: .semibold))
            .foregroundStyle(.white)
    }

    private var settingsPage: some View {
        Group {
            pageTitle("Settings").frame(minHeight: 32)
            Label("Watch paired", systemImage: "checkmark.circle.fill")
                .font(.footnote)
                .foregroundStyle(.white)
                .accessibilityIdentifier("watch-paired")
            switchRow("Buzz for alerts", enabled: buzz) { buzz.toggle() }
            if !readHealth || !shareReadings {
                control("Enable health sync", primary: true) {
                    Task {
                        if !readHealth { await enableHealth() }
                        if readHealth { shareReadings = true }
                    }
                }
                .disabled(healthBusy)
            }
            if readHealth && shareReadings {
                Text(mode == .demo ? "Simulation is active." : syncMessage.isEmpty ? "Waiting for health readings…" : syncMessage)
                    .font(.caption2)
                    .foregroundStyle(muted)
            }
            switchRow("Health readings", enabled: readHealth) {
                if readHealth {
                    readHealth = false
                    watchReadings = []
                    stopSharing()
                } else {
                    Task { await enableHealth() }
                }
            }
            .disabled(healthBusy)
            switchRow("Send to console", enabled: shareReadings) {
                if shareReadings { stopSharing() } else { shareReadings = true }
            }
            control("Disconnect console") { Task { await disconnect() } }
                .disabled(pairingBusy)
            if !sessionMessage.isEmpty {
                Text(sessionMessage).font(.caption2).foregroundStyle(muted)
            }
        }
    }

    private func switchRow(_ title: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Text(title).font(.footnote)
                Spacer(minLength: 3)
                Text(enabled ? "On" : "Off")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(muted)
            }
            .frame(minHeight: 40)
            .padding(.horizontal, 6)
            .background(controlSurface, in: RoundedRectangle(cornerRadius: 9))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityValue(enabled ? "On" : "Off")
    }

    private func stopSharing() {
        shareReadings = false
        syncMessage = ""
        outbox = outbox.map { $0.withoutWatchContext() }
        guard let token = pairing?.watchToken else { return }
        Task {
            do {
                _ = try await request("api/watch", method: "DELETE", token: token)
            } catch {
                sessionMessage = "Couldn’t clear the console snapshot."
            }
        }
    }

    private func pageTitle(_ title: String) -> some View {
        Text(title)
            .font(.system(.headline, design: .rounded))
            .accessibilityAddTraits(.isHeader)
    }

    private func metricGroup(_ source: String, readings: [TelemetryFrame.Reading]) -> some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 5), GridItem(.flexible())], spacing: 5) {
            ForEach(readings, id: \.metric) { reading in
                MetricTile(reading: reading, values: trends[trendKey(source, reading)]?.map(\.value) ?? [])
            }
        }
    }

    private func actionLabel(_ label: String, primary: Bool) -> some View {
        Text(label)
            .font(.system(.footnote, design: .rounded, weight: .semibold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: primary ? 58 : 44)
            .padding(.horizontal, 5)
            .background(primary ? blue.opacity(0.27) : controlSurface,
                        in: RoundedRectangle(cornerRadius: primary ? 22 : 16))
    }

    private func control(_ label: String, primary: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) { actionLabel(label, primary: primary) }
            .buttonStyle(.plain)
    }

    private func trendKey(_ source: String, _ reading: TelemetryFrame.Reading) -> String {
        "\(source)|\(reading.metric)|\(reading.unit)"
    }

    private func recordTrends(_ readings: [TelemetryFrame.Reading], source: String, at time: TimeInterval) {
        for reading in readings where reading.quality == "valid" {
            let key = trendKey(source, reading)
            let stamp = reading.measuredAt ?? time
            guard stamp > (trends[key]?.last?.time ?? -.infinity) else { continue }
            trends[key, default: []].append(.init(time: stamp, value: reading.value))
            if trends[key, default: []].count > 18 { trends[key]?.removeFirst() }
        }
    }

    private func start(_ selection: Mode) {
        frames = []
        trends = [:]
        motionReadings = []
        watchReadings = []
        latestSignal = nil
        showingReview = false
        delivery = ""
        mode = selection
    }

    @MainActor
    private func createPairing() async {
        guard !pairingBusy else { return }
        guard let gateway else {
            sessionMessage = "Enter the website address first, then get a pairing code."
            return
        }
        pairingBusy = true
        sessionMessage = ""
        defer { pairingBusy = false }
        do {
            guard let healthData = try? await request("api/v1/health"),
                  let health = try? JSONDecoder().decode(ConsoleHealth.self, from: healthData),
                  health.service == "gravityguard-mission-computer" else {
                sessionMessage = "Can’t reach the dashboard. Check the website address."
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
                let connected = try JSONDecoder().decode(PairingState.self, from: data).paired
                if connected && !paired {
                    page = .settings
                    syncMessage = ""
                    start(.watch)
                }
                paired = connected
                if connected { await refreshDailyPlan(token: pairing.watchToken) }
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
                mode = nil
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
        mode = nil
        sessionMessage = ""
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
            sessionMessage = "Sensor access unavailable."
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
                let next = mode == .demo ? [demoFrame(step: step)] : []
                try Task.checkCancellation()
                frames = next
                if mode != .demo {
                    recordTrends(motionReadings + watchReadings, source: "Watch sensors", at: now.timeIntervalSince1970)
                }
                for frame in next {
                    recordTrends(frame.readings, source: frame.source, at: frame.observedAt)
                    let wrist = motionReadings.first?.value
                    let pulse = watchReadings.first { $0.metric == "Heart rate" }
                    if var signal = rules[frame.source, default: SignalRules()]
                        .evaluate(frame, wristMotionG: wrist, watchPulse: pulse, now: .now) {
                        signal.hapticRequested = buzz
                        latestSignal = signal
                        if buzz { WKInterfaceDevice.current().play(.notification) }
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
                }
            } catch {
                guard !Task.isCancelled else { return }
                frames = []
            }
            if let token { await flushSignals(token: token) }
            step += 1
            try? await Task.sleep(for: .seconds(2))
        }
    }

    @MainActor
    private func syncWatchReadings(token: String) async {
        while !Task.isCancelled {
            if watchReadings.isEmpty {
                syncMessage = "Waiting for Apple Health readings…"
            } else {
                let frame = TelemetryFrame(version: 1, source: "Watch sensors",
                    observedAt: Date.now.timeIntervalSince1970, simulated: false,
                    readings: motionReadings + watchReadings)
                do {
                    try await publish(frame, token: token)
                    guard !Task.isCancelled else { return }
                    syncMessage = "Synced to Mission Health"
                } catch let error as GatewayError {
                    guard !Task.isCancelled else { return }
                    syncMessage = "Sync failed (HTTP \(error.status)). Retrying…"
                } catch {
                    guard !Task.isCancelled else { return }
                    syncMessage = "Can’t reach Mission Health. Retrying…"
                }
            }
            try? await Task.sleep(for: .seconds(5))
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
                .init(metric: "Environmental noise exposure", value: 58, unit: "dBA", quality: "valid", status: "nominal"),
                .init(metric: "Wrist motion", value: 0.12, unit: "g", quality: "valid", status: "nominal"),
                .init(metric: "Steps in latest sample", value: 36, unit: "steps", quality: "valid", status: "nominal")
            ]
        )
    }
}

struct ContentView_Previews: PreviewProvider {
    static var previews: some View { ContentView() }
}
