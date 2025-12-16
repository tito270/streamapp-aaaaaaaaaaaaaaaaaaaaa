import React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

export interface SinglePoint {
  time: number;
  bitrate: number;
}

interface BitrateGraphProps {
  data: SinglePoint[];
  color?: string;
  maxBitrate?: number;
  height?: number | string;
}

const BitrateGraph: React.FC<BitrateGraphProps> = ({ 
  data, 
  color = '#22c55e', 
  maxBitrate,
  height = 100 
}) => {
  const domain = maxBitrate ? [0, maxBitrate] : ['auto', 'auto'];
  
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
        <XAxis 
          dataKey="time" 
          tick={{ fontSize: 10 }} 
          stroke="hsl(var(--muted-foreground))"
          tickFormatter={(val) => {
            const date = new Date(val);
            return `${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`;
          }}
        />
        <YAxis 
          domain={domain as [number | string, number | string]}
          tick={{ fontSize: 10 }} 
          stroke="hsl(var(--muted-foreground))"
          tickFormatter={(val) => `${val.toFixed(1)}`}
        />
        <Tooltip 
          contentStyle={{ 
            backgroundColor: 'hsl(var(--card))', 
            border: '1px solid hsl(var(--border))',
            borderRadius: '6px'
          }}
          labelFormatter={(val) => new Date(val).toLocaleTimeString()}
          formatter={(value: number) => [`${value.toFixed(2)} Mbps`, 'Bitrate']}
        />
        <Area 
          type="monotone" 
          dataKey="bitrate" 
          stroke={color} 
          fill={color} 
          fillOpacity={0.3}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
};

export default BitrateGraph;
