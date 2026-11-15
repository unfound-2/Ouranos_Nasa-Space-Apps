import Foundation

struct TelemetryFrame: Codable {
    struct Reading: Codable {
        let metric: String
        let value: Double
        let unit: String
        let quality: String
        let status: String
        var measuredAt: TimeInterval? = nil

        func isRecent(at time: TimeInterval, window: TimeInterval) -> Bool {
            guard let measuredAt else { return false }
            return (-5...window).contains(time - measuredAt)
        }
    }

    let version: Int
    let source: String
    let observedAt: TimeInterval
    let simulated: Bool
    let readings: [Reading]
    var freshnessSeconds: TimeInterval? = nil

    var freshnessWindow: TimeInterval {
        min(180, max(15, freshnessSeconds ?? 15))
    }

    func isFresh(at now: Date) -> Bool {
        (-5...freshnessWindow).contains(now.timeIntervalSince1970 - observedAt)
    }
}

struct ReviewSignal: Codable, Identifiable {
    let id: UUID
    let createdAt: TimeInterval
    let frame: TelemetryFrame
    let evidence: [String]
    let wristMotionG: Double?
    let action: String
    var hapticRequested: Bool? = nil

    static let verifyAction = "Review the flagged channels, verify the readings with the source instrument, and share the verified results with the crew medical officer."

    func withoutWatchContext() -> Self {
        .init(id: id, createdAt: createdAt, frame: frame, evidence: evidence,
              wristMotionG: nil, action: Self.verifyAction, hapticRequested: hapticRequested)
    }
}

struct SignalRules {
    private var previousFrame: TelemetryFrame?
    private var previousFlags: Set<String> = []
    private var signaled = false
    private var signaledPriority: Set<String> = []

    mutating func evaluate(_ frame: TelemetryFrame, wristMotionG: Double?, watchPulse: TelemetryFrame.Reading? = nil, now: Date) -> ReviewSignal? {
        guard frame.version == 1, frame.isFresh(at: now) else {
            self = SignalRules()
            return nil
        }

        if let previousFrame {
            if previousFrame.source != frame.source ||
                previousFrame.simulated != frame.simulated ||
                frame.observedAt - previousFrame.observedAt > frame.freshnessWindow {
                self = SignalRules()
            } else if frame.observedAt <= previousFrame.observedAt {
                return nil
            }
        }

        let valid = frame.readings.filter {
            $0.quality == "valid" && ($0.measuredAt == nil ||
                $0.isRecent(at: now.timeIntervalSince1970, window: frame.freshnessWindow))
        }
        let priority = Set(valid.filter { $0.status == "priority" }.map(\.metric))
        let flags = Set(valid.filter { $0.status == "review" }.map(\.metric))
        let persistent = flags.intersection(previousFlags)
        previousFrame = frame
        previousFlags = flags

        signaledPriority.formIntersection(priority)
        if priority.isEmpty && flags.isEmpty {
            signaled = false
        }
        guard !priority.isEmpty || persistent.count >= 2 else { return nil }
        guard !signaled || !priority.subtracting(signaledPriority).isEmpty else { return nil }
        signaled = true
        signaledPriority.formUnion(priority)

        var action: String
        if let wristMotionG, wristMotionG >= 0.15 {
            action = "Review the flagged channels and confirm the reading with the source instrument. Wrist motion was elevated."
        } else {
            action = ReviewSignal.verifyAction
        }
        if !frame.simulated, let watchPulse,
           watchPulse.isRecent(at: now.timeIntervalSince1970, window: 15),
           let onboardPulse = valid.first(where: {
               $0.metric.lowercased() == "heart rate" && $0.unit.lowercased() == "bpm" &&
                   ($0.measuredAt == nil || $0.isRecent(at: now.timeIntervalSince1970, window: 15))
           }), abs(watchPulse.value - onboardPulse.value) >= 15 {
            action += " Watch and onboard pulse differ. Confirm with the crew instrument."
        }
        return ReviewSignal(
            id: UUID(), createdAt: now.timeIntervalSince1970, frame: frame,
            evidence: priority.union(persistent).sorted(), wristMotionG: wristMotionG, action: action
        )
    }
}
