import SwiftUI

enum BodyRegion: String, Identifiable {
    case head = "Head"
    case chest = "Chest"
    case core = "Core"
    case arms = "Arms"
    case legs = "Legs"

    var id: Self { self }

    func includes(_ metric: String) -> Bool {
        let name = metric.lowercased()
        let terms: [String]
        switch self {
        case .head: terms = ["noise", "audio", "daylight", "sleep in"]
        case .chest: terms = ["heart", "pulse", "ecg", "afib", "respirat", "breathing", "oxygen", "tidal", "vo₂"]
        case .core: terms = ["skin temperature", "energy", "exercise"]
        case .arms: terms = ["wrist", "swimming", "blood pressure"]
        case .legs: terms = ["step", "walk/run", "walking speed", "walking asymmetry",
                              "walking double", "running", "cycling", "flights", "stand time"]
        }
        return terms.contains { name.contains($0) }
    }
}

struct BodyFigure: View {
    let flagged: Bool
    let select: (BodyRegion) -> Void

    private let outline = Color(red: 0.15, green: 0.18, blue: 0.21)
    private let cobalt = Color(red: 0.23, green: 0.48, blue: 0.98)
    private let ice = Color(red: 0.70, green: 0.86, blue: 1)

    var body: some View {
        GeometryReader { geometry in
            let height = min(geometry.size.height, 184)
            let width = min(geometry.size.width, height * 0.54)
            ZStack {
                artwork
                regionButton(.head, width: width * 0.55, height: height * 0.15,
                             x: width * 0.5, y: height * 0.075)
                regionButton(.chest, width: width * 0.41, height: height * 0.18,
                             x: width * 0.5, y: height * 0.24)
                regionButton(.core, width: width * 0.41, height: height * 0.18,
                             x: width * 0.5, y: height * 0.42)
                regionButton(.arms, width: width * 0.29, height: height * 0.46,
                             x: width * 0.145, y: height * 0.39)
                regionButton(.arms, width: width * 0.29, height: height * 0.46,
                             x: width * 0.855, y: height * 0.39)
                    .accessibilityHidden(true)
                regionButton(.legs, width: width * 0.56, height: height * 0.48,
                             x: width * 0.5, y: height * 0.76)
            }
            .frame(width: width, height: height)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func regionButton(_ region: BodyRegion, width: CGFloat, height: CGFloat, x: CGFloat, y: CGFloat) -> some View {
        Button {
            select(region)
        } label: {
            Color.clear.frame(width: width, height: height).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(region.rawValue)
        .accessibilityHint("Shows readings")
        .position(x: x, y: y)
    }

    private var artwork: some View {
        Canvas { context, size in
            var drawing = context
            drawing.scaleBy(x: size.width / 54, y: size.height / 118)

            for side in 0..<2 {
                var half = drawing
                if side == 1 {
                    half.translateBy(x: 54, y: 0)
                    half.scaleBy(x: -1, y: 1)
                }
                paint(half, outline, [(27,12),(22,13),(19,17),(11,18),(8,24),(11,38),(13,48),
                                      (16,58),(15,67),(17,83),(19,94),(20,112),(23,118),(26,114),
                                      (27,93),(27,76),(27,67)])
                paint(half, outline, [(12,23),(8,23),(5,31),(5,41),(2,49),(0,60),(2,63),
                                      (5,59),(8,52),(12,41),(14,32)])
                let torso = flagged ? Color(red: 0.45, green: 0.78, blue: 1) : ice
                paint(half, cobalt, [(17,18),(13,19),(9,23),(10,29),(14,31),(17,25)])
                paint(half, cobalt.opacity(0.8), [(7,38),(5,42),(3,49),(2,57),(5,56),(9,47),(10,40)])
                paint(half, torso, [(24,18),(20,18),(17,23),(17,28),(19,33),(26,33),(26,23)])
                for row in 0..<3 {
                    let y = CGFloat(35 + row * 7)
                    paint(half, ice, [(20,y),(25,y),(26,y + 2),(26,y + 6),(22,y + 5)])
                }
                paint(half, cobalt, [(19,56),(16,61),(17,72),(20,85),(23,89),(25,86),(27,73),(25,65),(22,58)])
            }
            drawing.fill(Path(ellipseIn: CGRect(x: 21, y: 0, width: 12, height: 16)), with: .color(outline))
        }
        .accessibilityHidden(true)
    }

    private func paint(_ context: GraphicsContext, _ color: Color, _ corners: [(CGFloat, CGFloat)]) {
        let points = corners.map { CGPoint(x: $0.0, y: $0.1) }
        guard let first = points.first, let last = points.last else { return }
        var shape = Path()
        shape.move(to: midpoint(last, first))
        for index in points.indices {
            let next = points[(index + 1) % points.count]
            shape.addQuadCurve(to: midpoint(points[index], next), control: points[index])
        }
        shape.closeSubpath()
        context.fill(shape, with: .color(color))
    }

    private func midpoint(_ a: CGPoint, _ b: CGPoint) -> CGPoint {
        CGPoint(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2)
    }
}

struct MetricTile: View {
    let reading: TelemetryFrame.Reading
    let values: [Double]

    private let cyan = Color(red: 0.49, green: 0.91, blue: 1)
    private let cobalt = Color(red: 0.14, green: 0.43, blue: 0.98)

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(reading.metric == "Respiration" ? "Breathing" : reading.metric)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(.white.opacity(0.85))
                .lineLimit(2)
            Spacer(minLength: 0)
            if reading.quality == "valid" {
                if reading.unit == "%", (0...100).contains(reading.value) {
                    ZStack {
                        Circle().fill(.black.opacity(0.65))
                        Circle().stroke(cyan.opacity(0.18), lineWidth: 2)
                        Circle().trim(from: 0, to: reading.value / 100)
                            .stroke(cyan, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                            .rotationEffect(.degrees(-90))
                            .accessibilityHidden(true)
                        Text("\(reading.value, format: .number.precision(.fractionLength(0...2)))%")
                            .font(.system(size: 10, weight: .bold, design: .rounded))
                            .monospacedDigit()
                            .foregroundStyle(.white)
                            .lineLimit(1)
                            .minimumScaleFactor(0.65)
                            .padding(.horizontal, 4)
                    }
                    .frame(width: 37, height: 37)
                    .frame(maxWidth: .infinity)
                } else {
                    standardValue
                }
                if reading.status != "nominal" {
                    metricLabel(reading.status.capitalized)
                }
            } else {
                metricLabel(reading.quality == "missing" ? "Missing" : "Check reading")
            }
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 5)
        .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
        .background(Color(red: 0.09, green: 0.12, blue: 0.16),
                    in: RoundedRectangle(cornerRadius: 13))
        .accessibilityElement(children: .combine)
    }

    private var standardValue: some View {
        Group {
            if values.count > 1 {
                if reading.metric == "Heart rate" {
                    pulseBars.frame(height: 17).accessibilityHidden(true)
                } else {
                    sparkline.frame(height: 17).accessibilityHidden(true)
                }
            }
            Text(reading.value, format: .number.precision(.fractionLength(0...2)))
                .font(.system(size: 15, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.65)
            metricLabel(reading.unit)
        }
    }

    private func metricLabel(_ label: String) -> some View {
        Text(label)
            .font(.system(size: 9, weight: .medium))
            .foregroundStyle(.white)
    }

    private var pulseBars: some View {
        let samples = Array(values.suffix(8))
        let maximum = max(samples.max() ?? 1, 1)
        return HStack(alignment: .bottom, spacing: 2) {
            ForEach(samples.indices, id: \.self) { index in
                Capsule()
                    .fill(LinearGradient(colors: [cyan, cobalt], startPoint: .top, endPoint: .bottom))
                    .frame(height: max(2, 17 * samples[index] / maximum))
            }
        }
        .frame(maxHeight: .infinity, alignment: .bottom)
    }

    private var sparkline: some View {
        Canvas { context, size in
            guard let minimum = values.min(), let maximum = values.max(), values.count > 1 else { return }
            let range = maximum - minimum
            let step = (size.width - 2) / CGFloat(values.count - 1)
            let points: [CGPoint] = values.enumerated().map { index, value in
                let fraction = range == 0 ? 0.5 : CGFloat((maximum - value) / range)
                return CGPoint(x: 1 + step * CGFloat(index), y: 2 + (size.height - 4) * fraction)
            }
            var line = Path()
            line.addLines(points)
            var fill = line
            fill.addLine(to: CGPoint(x: size.width - 1, y: size.height))
            fill.addLine(to: CGPoint(x: 1, y: size.height))
            fill.closeSubpath()
            context.fill(fill, with: .linearGradient(
                Gradient(colors: [cyan.opacity(0.5), cobalt.opacity(0.08)]),
                startPoint: .zero, endPoint: CGPoint(x: 0, y: size.height)
            ))
            context.stroke(line, with: .color(cyan), style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
        }
    }
}
