import { createInterface } from 'node:readline';

const channels = {
  ecg_heart_rate: ['Heart rate', 'bpm'],
  heart_rate: ['Heart rate', 'bpm'],
  ecg_summary: ['ECG summary', 'index'],
  spo2: ['Blood oxygen', '%'],
  systolic_bp: ['Systolic blood pressure', 'mmHg'],
  diastolic_bp: ['Diastolic blood pressure', 'mmHg'],
  respiration_rate: ['Respiration', '/min'],
  tidal_volume: ['Tidal volume', 'mL'],
  minute_ventilation: ['Minute ventilation', 'L/min'],
  skin_temperature: ['Skin temperature', '°C'],
  body_temperature: ['Body temperature', '°C'],
  glucose: ['Blood glucose', 'mg/dL'],
  sleep_duration: ['Sleep duration', 'h'],
  actigraphy: ['Actigraphy', 'g'],
  suit_pressure: ['Suit pressure', 'psia'],
  primary_oxygen_pressure: ['Primary oxygen tank pressure', 'psia'],
  secondary_oxygen_pressure: ['Secondary oxygen tank pressure', 'psia'],
  suit_co2_partial_pressure: ['Suit carbon dioxide partial pressure', 'mmHg'],
  cooling_water_temperature: ['Cooling water temperature', '°C'],
  cooling_water_pressure: ['Cooling water pressure', 'psi'],
  battery_voltage: ['Suit battery voltage', 'V'],
  fan_speed: ['Suit fan speed', 'rpm'],
  absorbed_radiation_dose_rate: ['Absorbed radiation dose rate', 'µGy/h']
};

export function normalize(packet) {
  if (!packet?.source || !Number.isFinite(packet.observedAt) ||
      !packet.channels || typeof packet.channels !== 'object') {
    throw new Error('Packet needs source, observedAt and channels');
  }
  const readings = new Map();
  for (const [key, input] of Object.entries(packet.channels)) {
    const [metric, unit] = Object.hasOwn(channels, key) ? channels[key] : [input?.metric, input?.unit];
    if (!metric || !unit || !Number.isFinite(input?.value)) {
      throw new Error('Invalid channel ' + key);
    }
    if (readings.has(metric)) throw new Error('Duplicate channel ' + metric);
    if (input.unit !== undefined && input.unit !== unit) throw new Error('Convert units for ' + key);
    readings.set(metric, {
      metric, unit, value: input.value,
      quality: input.quality ?? 'suspect',
      status: input.status ?? 'nominal',
      measuredAt: input.measuredAt ?? packet.observedAt
    });
  }
  return { version: 1, source: packet.source, observedAt: packet.observedAt, simulated: false,
    freshnessSeconds: packet.freshnessSeconds, readings: Array.from(readings.values()) };
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const token = process.env.GRAVITYGUARD_ADAPTER_TOKEN;
  if (!token) throw new Error('Set GRAVITYGUARD_ADAPTER_TOKEN from the paired Crew Console');
  const base = process.env.GRAVITYGUARD_GATEWAY_URL ?? 'http://127.0.0.1:4317';
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    try {
      const frame = normalize(JSON.parse(line));
      const result = await fetch(new URL('/api/telemetry', base), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(frame),
        signal: AbortSignal.timeout(4000)
      });
      if (!result.ok) throw new Error(await result.text());
      console.log('Accepted ' + frame.source + ' · ' + frame.readings.length + ' readings');
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
