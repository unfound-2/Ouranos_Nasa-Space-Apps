import HealthKit

@MainActor
final class WatchBiometrics {
    private struct Metric {
        let type: HKQuantityType
        let name: String
        let unit: HKUnit
        let label: String
        let scale: Double

        init(_ id: HKQuantityTypeIdentifier, _ name: String, _ unit: HKUnit,
             _ label: String, scale: Double = 1) {
            type = HKQuantityType(id)
            self.name = name
            self.unit = unit
            self.label = label
            self.scale = scale
        }
    }

    private let store = HKHealthStore()
    private let sleep = HKCategoryType(.sleepAnalysis)
    private let ecg = HKObjectType.electrocardiogramType()

    private static let bpm = HKUnit.count().unitDivided(by: .minute())
    private var metrics: [Metric] {
        var supported: [Metric] = [
            .init(.heartRate, "Heart rate", Self.bpm, "bpm"),
            .init(.restingHeartRate, "Resting heart rate", Self.bpm, "bpm"),
            .init(.walkingHeartRateAverage, "Walking heart rate", Self.bpm, "bpm"),
            .init(.heartRateRecoveryOneMinute, "One-minute heart-rate recovery", Self.bpm, "bpm"),
            .init(.heartRateVariabilitySDNN, "Heart-rate variability SDNN", .secondUnit(with: .milli), "ms"),
            .init(.respiratoryRate, "Respiration", Self.bpm, "/min"),
            .init(.oxygenSaturation, "Blood oxygen", .percent(), "%", scale: 100),
            .init(.appleSleepingWristTemperature, "Sleeping wrist temperature", .degreeCelsius(), "°C"),
            .init(.atrialFibrillationBurden, "AFib history estimate", .percent(), "%", scale: 100),
            .init(.vo2Max, "Estimated VO₂ max", HKUnit(from: "ml/kg*min"), "mL/kg/min"),
            .init(.stepCount, "Steps in latest sample", .count(), "steps"),
            .init(.distanceWalkingRunning, "Walk/run distance in latest sample", .meter(), "m"),
            .init(.distanceCycling, "Cycling distance in latest sample", .meter(), "m"),
            .init(.distanceSwimming, "Swimming distance in latest sample", .meter(), "m"),
            .init(.flightsClimbed, "Flights climbed in latest sample", .count(), "flights"),
            .init(.activeEnergyBurned, "Active energy in latest sample", .kilocalorie(), "kcal"),
            .init(.basalEnergyBurned, "Resting energy in latest sample", .kilocalorie(), "kcal"),
            .init(.appleExerciseTime, "Exercise time in latest sample", .minute(), "min"),
            .init(.appleStandTime, "Stand time in latest sample", .minute(), "min"),
            .init(.walkingSpeed, "Walking speed", .meter().unitDivided(by: .second()), "m/s"),
            .init(.walkingStepLength, "Walking step length", .meter(), "m"),
            .init(.walkingAsymmetryPercentage, "Walking asymmetry", .percent(), "%", scale: 100),
            .init(.walkingDoubleSupportPercentage, "Walking double support", .percent(), "%", scale: 100),
            .init(.environmentalAudioExposure, "Environmental noise exposure", .decibelAWeightedSoundPressureLevel(), "dBA"),
            .init(.headphoneAudioExposure, "Headphone audio exposure", .decibelAWeightedSoundPressureLevel(), "dBA"),
            .init(.timeInDaylight, "Daylight time in latest sample", .minute(), "min"),
            .init(.runningSpeed, "Running speed", .meter().unitDivided(by: .second()), "m/s"),
            .init(.runningPower, "Running power", .watt(), "W"),
            .init(.runningStrideLength, "Running stride length", .meter(), "m"),
            .init(.runningGroundContactTime, "Running ground contact time", .secondUnit(with: .milli), "ms"),
            .init(.runningVerticalOscillation, "Running vertical oscillation", .meter(), "m"),
            .init(.cyclingSpeed, "Cycling speed", .meter().unitDivided(by: .second()), "m/s"),
            .init(.cyclingPower, "Cycling power", .watt(), "W"),
            .init(.cyclingCadence, "Cycling cadence", Self.bpm, "rpm"),
            .init(.underwaterDepth, "Underwater depth", .meter(), "m"),
            .init(.waterTemperature, "Water temperature", .degreeCelsius(), "°C")
        ]
        if #available(watchOS 11.0, *) {
            supported.append(.init(.appleSleepingBreathingDisturbances, "Sleeping breathing disturbances", .count(), "count"))
        }
        return supported
    }

    func authorize() async throws {
        guard HKHealthStore.isHealthDataAvailable() else { throw CocoaError(.featureUnsupported) }
        var types = Set<HKObjectType>(metrics.map(\.type))
        types.formUnion([sleep, ecg])
        try await store.requestAuthorization(toShare: [], read: types)
    }

    func read() async -> [TelemetryFrame.Reading] {
        let now = Date.now
        let recent = HKQuery.predicateForSamples(withStart: now.addingTimeInterval(-7 * 86400), end: now, options: .strictEndDate)
        var readings: [TelemetryFrame.Reading] = []
        for metric in metrics {
            if Task.isCancelled { return [] }
            let query = HKSampleQueryDescriptor(
                predicates: [.quantitySample(type: metric.type, predicate: recent)],
                sortDescriptors: [SortDescriptor(\HKQuantitySample.endDate, order: .reverse)], limit: 32
            )
            guard let samples = try? await query.result(for: store),
                  let sample = samples.first(where: Self.fromWatch),
                  sample.quantity.is(compatibleWith: metric.unit) else { continue }
            readings.append(.init(metric: metric.name, value: sample.quantity.doubleValue(for: metric.unit) * metric.scale,
                                  unit: metric.label, quality: "valid", status: "nominal",
                                  measuredAt: sample.endDate.timeIntervalSince1970))
        }

        let sleepQuery = HKSampleQueryDescriptor(
            predicates: [.categorySample(type: sleep, predicate: HKQuery.predicateForSamples(
                withStart: now.addingTimeInterval(-86400), end: now
            ))],
            sortDescriptors: [SortDescriptor(\HKCategorySample.startDate)]
        )
        if let samples = try? await sleepQuery.result(for: store) {
            let asleep = samples.filter {
                Self.fromWatch($0) &&
                HKCategoryValueSleepAnalysis.allAsleepValues.contains(HKCategoryValueSleepAnalysis(rawValue: $0.value) ?? .awake)
            }
            if let last = asleep.map(\.endDate).max() {
                let cutoff = now.addingTimeInterval(-86400)
                var end = cutoff
                var duration = 0.0
                for sample in asleep {
                    duration += max(0, sample.endDate.timeIntervalSince(max(sample.startDate, end)))
                    end = max(end, sample.endDate)
                }
                readings.append(.init(metric: "Sleep in last 24 hours", value: duration / 3600, unit: "h",
                                      quality: "valid", status: "nominal", measuredAt: last.timeIntervalSince1970))
            }
        }

        let ecgQuery = HKSampleQueryDescriptor(
            predicates: [HKSamplePredicate<HKElectrocardiogram>.electrocardiogram(recent)],
            sortDescriptors: [SortDescriptor(\HKElectrocardiogram.endDate, order: .reverse)], limit: 5
        )
        if let samples = try? await ecgQuery.result(for: store),
           let sample = samples.first(where: Self.fromWatch), let pulse = sample.averageHeartRate {
            readings.append(.init(metric: "Recorded ECG average pulse", value: pulse.doubleValue(for: Self.bpm),
                                  unit: "bpm", quality: "valid", status: "nominal",
                                  measuredAt: sample.endDate.timeIntervalSince1970))
        }
        return readings
    }

    private nonisolated static func fromWatch(_ sample: HKSample) -> Bool {
        guard sample.metadata?[HKMetadataKeyWasUserEntered] as? Bool != true else { return false }
        return sample.sourceRevision.productType?.lowercased().hasPrefix("watch") == true ||
            (sample.device?.manufacturer == "Apple Inc." && sample.device?.model?.lowercased().contains("watch") == true)
    }
}
