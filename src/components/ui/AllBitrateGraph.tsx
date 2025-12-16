import React from "react";
import {
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from "recharts";
import type { ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";

export interface BitrateDataPoint {
  time: number;
  [key: string]: number | null | undefined;
}

export interface StreamDef {
  id: string;
  name: string;
  color: string;
}

export interface AllBitrateGraphProps {
  data: BitrateDataPoint[];
  streams: StreamDef[];
  maxBitrate?: number;
  timeDomain: [number, number]; // preferred initial domain
  height?: number | string;
}

interface TickProps {
  x?: number;
  y?: number;
  payload?: { value: number };
}

const CustomYAxisTick: React.FC<TickProps> = ({ x, y, payload }) => {
  if (x == null || y == null || !payload) return null;
  const v = Number(payload.value);
  const label = Number.isFinite(v) ? `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)} Mbps` : "";
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={-8} dy={4} textAnchor="end" fill="#aaa" fontSize={12} style={{ userSelect: "none" }}>
        {label}
      </text>
    </g>
  );
};

const CustomXAxisTick: React.FC<TickProps> = ({ x, y, payload }) => {
  if (x == null || y == null || !payload) return null;
  const text = new Date(payload.value).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return (
    <g transform={`translate(${x},${y})`}>
      <text dy={16} textAnchor="end" transform="rotate(-45)" fill="#555" fontSize={12} style={{ userSelect: "none" }}>
        {text}
      </text>
    </g>
  );
};

const AllBitrateGraph: React.FC<AllBitrateGraphProps> = ({
  data,
  streams,
  maxBitrate = 8,
  timeDomain: initialTimeDomain,
  height = "60vh",
}) => {
  const formatMbps = React.useCallback((n?: number) => {
    if (!Number.isFinite(n)) return "";
    return n! < 10 ? n!.toFixed(2) : n!.toFixed(1);
  }, []);

  const todayLabel = React.useMemo(
    () => new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }),
    []
  );

  // Smooth + split est/actual series and sort by time
  const processedData = React.useMemo<BitrateDataPoint[]>(() => {
    if (!data?.length) return [];
    const alpha = 0.25;
    const ema: Record<string, number | undefined> = {};
    const out = data.map((d) => {
      const item: BitrateDataPoint = { time: d.time };
      streams.forEach((s) => {
        const id = s.id;
        const estKey = `${id}__est`;
        const raw = d[id];
        const isEst = Boolean(d[estKey]);
        if (typeof raw === "number" && Number.isFinite(raw)) {
          const prev = ema[id];
          const smoothed = prev == null ? raw : alpha * raw + (1 - alpha) * prev;
          ema[id] = smoothed;
          const rounded = Math.round(smoothed * 10) / 10;
          if (isEst) {
            item[id] = null;
            item[estKey] = rounded;
          } else {
            item[id] = rounded;
            item[estKey] = null;
          }
        } else {
          item[id] = null;
          item[estKey] = null;
        }
      });
      return item;
    });
    return out.sort((a, b) => a.time - b.time);
  }, [data, streams]);

  // Data extent for clamping & anchoring
  const [dataMin, dataMax] = React.useMemo<[number, number]>(() => {
    if (!processedData.length) {
      const now = Date.now();
      return [now - 60 * 60 * 1000, now];
    }
    const t0 = processedData[0].time;
    const t1 = processedData[processedData.length - 1].time;
    return [t0, t1];
  }, [processedData]);

  // Initial X domain: respect prop if valid, else last hour
  const [xDomain, setXDomain] = React.useState<[number, number]>(() => {
    const [minI, maxI] =
      initialTimeDomain && Number.isFinite(initialTimeDomain[0]) && Number.isFinite(initialTimeDomain[1])
        ? initialTimeDomain
        : ((): [number, number] => {
            const now = Date.now();
            return [now - 60 * 60 * 1000, now];
          })();
    // Clamp to data initially
    const min = Math.min(minI, maxI);
    const max = Math.max(minI, maxI);
    return [Math.max(min, dataMin), Math.min(max, dataMax)];
  });

  // Auto Y domain
  const [yDomain, setYDomain] = React.useState<[number, number]>([0, Math.max(8, maxBitrate)]);
  React.useEffect(() => {
    let maxObs = 0;
    for (const p of processedData) {
      for (const k in p) {
        if (k === "time") continue;
        const v = p[k];
        if (typeof v === "number" && v > maxObs) maxObs = v;
      }
    }
    const suggestedMax = Math.max(maxObs, maxBitrate, 8);
    const padding = Math.max(5, Math.round(suggestedMax * 0.08));
    setYDomain([0, suggestedMax + padding]);
  }, [processedData, maxBitrate]);

  // Adaptive minute ticks (keeps ~8–12 labels)
  const minuteTicks = React.useMemo(() => {
    const [start, end] = xDomain;
    const range = Math.max(1, end - start);
    const idealTickCount = 10;
    // candidate steps in minutes
    const stepsMin = [1, 2, 5, 10, 15, 30, 60, 120, 240];
    const bestStepMin =
      stepsMin.reduce((best, s) => {
        const ticks = Math.ceil(range / (s * 60_000));
        const diff = Math.abs(ticks - idealTickCount);
        const bestDiff = Math.abs(Math.ceil(range / (best * 60_000)) - idealTickCount);
        return diff < bestDiff ? s : best;
      }, stepsMin[0]) || 1;
    const stepMs = bestStepMin * 60_000;
    const first = Math.floor(start / stepMs) * stepMs;
    const ticks: number[] = [];
    for (let t = first; t <= end + 1; t += stepMs) ticks.push(t);
    return ticks;
  }, [xDomain]);

  // Generic zoom helper: factor < 1 zooms in, > 1 zooms out; anchor defaults to "right" (latest)
  function zoom(factor: number, anchor: "left" | "right" | "center" = "right") {
    setXDomain(([min, max]) => {
      const currentRange = Math.max(1, max - min);
      const newRange = Math.max(5_000, currentRange * factor); // never less than 5s
      let nextMin = min;
      let nextMax = max;

      if (anchor === "right") {
        nextMax = Math.max(max, dataMax); // stay near latest data
        nextMin = nextMax - newRange;
      } else if (anchor === "left") {
        nextMin = Math.min(min, dataMin);
        nextMax = nextMin + newRange;
      } else {
        const center = (min + max) / 2;
        nextMin = center - newRange / 2;
        nextMax = center + newRange / 2;
      }

      // Clamp to data extent (allow a tiny overflow so labels aren't cut)
      const pad = 0;
      const clampedMin = Math.max(dataMin - pad, nextMin);
      const clampedMax = Math.min(dataMax + pad, nextMax);

      // If clamped window collapsed (e.g., very close to end), anchor to right on dataMax
      if (clampedMax - clampedMin < 5_000) {
        return [Math.max(dataMin, dataMax - newRange), dataMax];
      }
      return [clampedMin, clampedMax];
    });
  }

  const zoomIn = () => zoom(0.5, "right"); // halve width, keep right edge fixed
  const zoomOut = () => zoom(2, "right");  // double width, keep right edge fixed

  // Optional: Reset to "last hour ending at latest data"
  const reset = () => {
    const oneHour = 60 * 60 * 1000;
    const end = dataMax;
    const start = end - oneHour;
    setXDomain([start, end]);
  };

  if (!processedData.length) {
    return (
      <div style={{ width: "100%", height, display: "flex", alignItems: "center", justifyContent: "center", color: "#aaa" }}>
        No bitrate data yet
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height, position: "relative", userSelect: "none" }}>
      {/* Zoom controls */}
      <div
        style={{
          position: "absolute",
          top: "35%",
          left: 0,
          width: 60,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          backgroundColor: "#222",
          borderRadius: 4,
          padding: "8px 4px",
          boxShadow: "0 0 5px rgba(0,0,0,0.7)",
          color: "#fff",
          fontWeight: "bold",
          fontSize: 14,
          zIndex: 20,
        }}
      >
        <div style={{ marginBottom: 8 }}>Zoom</div>
        <button
          onClick={zoomIn}
          style={{
            backgroundColor: "#444",
            border: "none",
            color: "#fff",
            fontSize: 20,
            cursor: "pointer",
            width: 30,
            height: 30,
            marginBottom: 8,
            borderRadius: 4,
          }}
        >
          +
        </button>
        <button
          onClick={zoomOut}
          style={{
            backgroundColor: "#444",
            border: "none",
            color: "#fff",
            fontSize: 20,
            cursor: "pointer",
            width: 30,
            height: 30,
            marginBottom: 8,
            borderRadius: 4,
          }}
        >
          −
        </button>
        <button
          onClick={reset}
          style={{
            backgroundColor: "#555",
            border: "none",
            color: "#fff",
            fontSize: 12,
            cursor: "pointer",
            width: 50,
            height: 26,
            borderRadius: 4,
          }}
        >
          Reset
        </button>
      </div>

      <div style={{ position: "absolute", top: 2, left: 180, color: "#aaa", fontSize: 14, zIndex: 10 }}>{todayLabel}</div>

      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={processedData} margin={{ top: 5, right: 30, left: 80, bottom: 50 }}>
          <defs>
            {streams.map((stream) => (
              <linearGradient key={stream.id} id={`color-${stream.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={stream.color} stopOpacity={0.8} />
                <stop offset="95%" stopColor={stream.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="#333" />

          <XAxis
            dataKey="time"
            type="number"
            domain={xDomain}
            ticks={minuteTicks}
            tickFormatter={(v) =>
              new Date(v).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })
            }
            stroke="#888"
            interval={0}
            tick={<CustomXAxisTick />}
          />

          <YAxis domain={yDomain} tick={<CustomYAxisTick />} width={80} allowDecimals />

          <Tooltip
            labelFormatter={(label) => new Date(Number(label)).toLocaleString("en-GB")}
            formatter={(value: ValueType, name: NameType) => {
              const n = String(name);
              if (value == null) return null;
              if (n.endsWith("__est")) return null;
              const baseId = n.endsWith("__est") ? n.slice(0, -5) : n;
              const stream = streams.find((s) => s.id === baseId);
              const streamName = stream?.name ?? baseId;
              const num = typeof value === "number" ? value : Number(value);
              const formatted = Number.isFinite(num) ? formatMbps(num) : String(value);
              return [`${formatted} Mbps`, streamName] as [ValueType, NameType];
            }}
            contentStyle={{ backgroundColor: "#222", border: "1px solid #444" }}
          />

          <Legend formatter={(dataKey) => streams.find((s) => s.id === dataKey)?.name ?? String(dataKey)} />

          {streams.map((stream) => {
            const estKey = `${stream.id}__est`;
            return (
              <React.Fragment key={stream.id}>
                <Area
                  type="basis"
                  dataKey={stream.id}
                  stroke={stream.color}
                  strokeWidth={2}
                  fillOpacity={0.14}
                  fill={`url(#color-${stream.id})`}
                  isAnimationActive={false}
                  connectNulls
                />
                <Line
                  type="basis"
                  dataKey={stream.id}
                  stroke={stream.color}
                  strokeWidth={2.5}
                  strokeOpacity={1}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
                <Line
                  type="basis"
                  dataKey={estKey}
                  stroke={stream.color}
                  strokeDasharray="6 4"
                  strokeWidth={2}
                  strokeOpacity={0.7}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                  legendType="none"
                />
              </React.Fragment>
            );
          })}

          {streams.map((stream) => {
            let entry: { time: number; value: number } | null = null;
            for (let i = processedData.length - 1; i >= 0; i--) {
              const v = processedData[i][stream.id];
              if (typeof v === "number") {
                entry = { time: processedData[i].time, value: v };
                break;
              }
            }
            if (!entry) return null;
            return (
              <ReferenceLine
                key={`ref-${stream.id}`}
                x={Math.max(entry.time, xDomain[0])}
                y={entry.value}
                strokeOpacity={0}
                label={{
                  value: `${stream.name} : ${formatMbps(entry.value)} Mbps`,
                  position: "right",
                  fill: stream.color,
                  fontSize: 12,
                }}
              />
            );
          })}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export default AllBitrateGraph;
