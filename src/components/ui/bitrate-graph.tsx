import React, { useState, useEffect } from 'react';
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
} from 'recharts';

// Support two modes:
// 1) Multi-stream full chart: props { data: Array<{time, [streamId]: number|null}>, streams, timeDomain, height }
// 2) Single-stream compact chart (used by VideoPlayer & BitratePanel): props { data: Array<{time, bitrate}>, color?, maxBitrate? }

export interface SinglePoint {
  time: number;
  bitrate: number;
}

export interface MultiPoint {
  time: number;
  [key: string]: number | null | undefined | boolean;
}

interface SharedProps {
  height?: number | string;
}

interface MultiProps extends SharedProps {
  // multi-stream
  data: MultiPoint[];
  streams: { id: string; name: string; color: string }[];
  maxBitrate?: number;
  timeDomain: [number, number];
}

interface SingleProps extends SharedProps {
  // single-stream
  data: SinglePoint[];
  color?: string;
  maxBitrate?: number;
}

