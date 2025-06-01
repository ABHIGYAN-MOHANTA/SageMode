import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

interface ProcessInfo {
  name: string;
  cpu_usage: number;
  memory_usage: number;
  duration: number;
}

interface AppUsage {
  name: string;
  totalDuration: number;
}

interface TimeEntry {
  app_name: string;
  start_time: number;
  end_time: number;
}

interface LayoutEntry extends TimeEntry {
  column: number;
  maxColumns: number;
  width: number;
  left: number;
}

function layoutTimeEntries(entries: TimeEntry[]): LayoutEntry[] {
  if (entries.length === 0) return [];

  // Sort entries by start time, then by end time
  const sorted = [...entries].sort((a, b) => {
    if (a.start_time !== b.start_time) {
      return a.start_time - b.start_time;
    }
    return a.end_time - b.end_time;
  });

  const layoutEntries: LayoutEntry[] = [];

  // Process each entry
  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];

    // Find all previously processed entries that overlap with this one
    const overlapping = layoutEntries.filter(existing =>
      !(entry.end_time <= existing.start_time || entry.start_time >= existing.end_time)
    );

    // Find the first available column
    const usedColumns = new Set(overlapping.map(e => e.column));
    let column = 0;
    while (usedColumns.has(column)) {
      column++;
    }

    // Add this entry
    const newEntry: LayoutEntry = {
      ...entry,
      column,
      maxColumns: Math.max(column + 1, overlapping.length > 0 ? Math.max(...overlapping.map(e => e.maxColumns)) : 1),
      width: 0,
      left: 0
    };

    layoutEntries.push(newEntry);

    // Now find ALL entries that overlap with this one (including future ones)
    const allOverlapping = layoutEntries.filter(existing =>
      !(entry.end_time <= existing.start_time || entry.start_time >= existing.end_time)
    );

    // Update maxColumns for all overlapping entries
    const maxCols = Math.max(...allOverlapping.map(e => e.column)) + 1;
    allOverlapping.forEach(existing => {
      existing.maxColumns = Math.max(existing.maxColumns, maxCols);
    });
  }

  // Final pass: ensure all overlapping groups have consistent maxColumns
  for (let i = 0; i < layoutEntries.length; i++) {
    const entry = layoutEntries[i];
    const overlapping = layoutEntries.filter(other =>
      other !== entry && !(entry.end_time <= other.start_time || entry.start_time >= other.end_time)
    );

    if (overlapping.length > 0) {
      const maxCols = Math.max(entry.maxColumns, ...overlapping.map(e => e.maxColumns));
      entry.maxColumns = maxCols;
      overlapping.forEach(other => {
        other.maxColumns = maxCols;
      });
    }
  }

  // Calculate width and left position for each entry
  layoutEntries.forEach(entry => {
    entry.width = (100 / entry.maxColumns) - 1; // Subtract 1% for margin
    entry.left = (entry.column * 100) / entry.maxColumns;
  });

  return layoutEntries;
}

function App() {
  const [cpuUsage, setCpuUsage] = useState<number>(0);
  const [memoryUsage, setMemoryUsage] = useState<number>(0);
  const [activeProcesses, setActiveProcesses] = useState<ProcessInfo[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);

  const MIN_ENTRY_HEIGHT = 30; // Increased minimum height
  const HOUR_HEIGHT = 80; // Increased hour height for better visibility
  const MIN_DURATION_DISPLAY = 300; // 5 minutes minimum display time

  // Custom tooltip for pie chart
  const PieTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const entry = payload[0].payload;
      return (
        <div style={{ background: '#222', color: '#fff', padding: 8, borderRadius: 6, border: 'none' }}>
          <div><strong>{entry.name}</strong></div>
          <div>Time Spent: {formatDuration(entry.totalDuration)}</div>
        </div>
      );
    }
    return null;
  };

  useEffect(() => {
    const fetchSystemInfo = async () => {
      try {
        const [cpu, memory, processes, entries] = await Promise.all([
          invoke<number>("get_cpu_usage"),
          invoke<number>("get_memory_usage"),
          invoke<ProcessInfo[]>("get_active_processes"),
          invoke<TimeEntry[]>("get_time_entries")
        ]);
        setCpuUsage(cpu);
        setMemoryUsage(memory);
        setActiveProcesses(processes);
        setTimeEntries(entries);
      } catch (error) {
        console.error("Failed to fetch system info:", error);
      }
    };

    // Update system info every second
    const interval = setInterval(fetchSystemInfo, 1000);
    fetchSystemInfo(); // Initial fetch

    return () => clearInterval(interval);
  }, []);

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    } else {
      return `${remainingSeconds}s`;
    }
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getTimePosition = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    const hour = date.getHours();
    const minutes = date.getMinutes();
    const seconds = date.getSeconds();
    return (hour + minutes / 60 + seconds / 3600) * HOUR_HEIGHT;
  };

  const getTimeHeight = (start: number, end: number) => {
    const duration = end - start;
    const actualDuration = Math.max(duration, MIN_DURATION_DISPLAY);
    const height = (actualDuration / 3600) * HOUR_HEIGHT;
    return Math.max(height, MIN_ENTRY_HEIGHT);
  };

  const getTimelineHeight = () => {
    if (timeEntries.length === 0) return 24 * HOUR_HEIGHT;

    const maxEnd = Math.max(...timeEntries.map(e => e.end_time));
    const minStart = Math.min(...timeEntries.map(e => e.start_time));

    const startDate = new Date(minStart * 1000);
    const endDate = new Date(maxEnd * 1000);

    const startHour = startDate.getHours() + startDate.getMinutes() / 60;
    const endHour = endDate.getHours() + endDate.getMinutes() / 60 + 1; // Add padding

    const totalHours = Math.max(24, Math.ceil(endHour - startHour + 2));
    return totalHours * HOUR_HEIGHT;
  };

  const generateHourMarkers = () => {
    const timelineHeight = getTimelineHeight();
    const hours = Math.ceil(timelineHeight / HOUR_HEIGHT);
    const markers = [];

    for (let hour = 0; hour < hours; hour++) {
      markers.push(
        <div key={hour} className="hour-marker" style={{ top: hour * HOUR_HEIGHT }}>
          <span className="hour-label">{`${hour.toString().padStart(2, '0')}:00`}</span>
          <div className="hour-line" />
        </div>
      );
    }
    return markers;
  };

  const getAggregatedAppUsage = (entries: TimeEntry[]): AppUsage[] => {
    const usageMap = new Map<string, number>();
    
    entries.forEach(entry => {
      const duration = entry.end_time - entry.start_time;
      const currentTotal = usageMap.get(entry.app_name) || 0;
      usageMap.set(entry.app_name, currentTotal + duration);
    });

    return Array.from(usageMap.entries())
      .map(([name, totalDuration]) => ({ name, totalDuration }))
      .sort((a, b) => b.totalDuration - a.totalDuration);
  };

  // Layout the time entries to avoid overlap
  const layoutEntries = layoutTimeEntries(timeEntries);

  // Add color palette for pie chart
  const COLORS = [
    '#4a3d84', '#665693', '#24c8db', '#61dafb', '#747bff', '#8884d8', '#82ca9d', '#ffc658', '#ff8042', '#a4de6c', '#d0ed57', '#8dd1e1', '#d88884', '#a28fd0', '#f6c85f', '#6f4e7c'
  ];

  return (
    <main className="container">
      <div className="tab-bar">
        <h1 className="tab-bar-title">SageMode</h1>
        <div className="tab-bar-metrics">
          <div className="tab-metric">
            <span>CPU</span>
            <div className="tab-bar-progress">
              <div
                className="tab-bar-progress-fill"
                style={{ width: `${cpuUsage}%` }}
              />
            </div>
            <span>{cpuUsage.toFixed(1)}%</span>
          </div>
          <div className="tab-metric">
            <span>Memory</span>
            <div className="tab-bar-progress">
              <div
                className="tab-bar-progress-fill"
                style={{ width: `${memoryUsage}%` }}
              />
            </div>
            <span>{memoryUsage.toFixed(1)}%</span>
          </div>
        </div>
      </div>

      <div className="main-content">
        <div className="process-list">
          <h2>Daily App Usage</h2>
          <div className="process-grid">
            {getAggregatedAppUsage(timeEntries).map((app, index) => (
              <div key={index} className="process-card">
                <div className="process-header">
                  <span className="process-name">{app.name}</span>
                  <span className="process-duration">{formatDuration(app.totalDuration)}</span>
                </div>
              </div>
            ))}
          </div>
          {/* Pie Chart for App Usage Distribution */}
          <div style={{ width: '100%', height: 200 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={getAggregatedAppUsage(timeEntries)}
                  dataKey="totalDuration"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={70}
                  fill="#8884d8"
                  label={({ name }) => name.length > 10 ? name.slice(0, 10) + '…' : name}
                >
                  {getAggregatedAppUsage(timeEntries).map((entry, idx) => (
                    <Cell key={`cell-${idx}`} fill={COLORS[idx % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  content={PieTooltip}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="calendar-view">
          <h2>Daily Activity</h2>
          <div className="timeline-container">
            <div className="timeline" style={{ height: getTimelineHeight(), position: 'relative' }}>
              {generateHourMarkers()}
              {layoutEntries.map((entry, index) => {
                const top = getTimePosition(entry.start_time);
                const height = getTimeHeight(entry.start_time, entry.end_time);
                const duration = entry.end_time - entry.start_time;

                return (
                  <div
                    key={index}
                    className="time-entry"
                    style={{
                      position: 'absolute',
                      top: `${top}px`,
                      height: `${height}px`,
                      left: `${entry.left}%`,
                      width: `${entry.width}%`,
                      minHeight: MIN_ENTRY_HEIGHT,
                      marginRight: '4px',
                      marginLeft: '2px',
                      boxSizing: 'border-box',
                      border: '1px solid rgba(255,255,255,0.2)',
                      borderRadius: '4px',
                      background: `#4a3d84`,
                      color: 'white',
                      padding: '4px 8px',
                      overflow: 'hidden'
                    }}
                    title={`${entry.app_name}\n${formatTime(entry.start_time)} - ${formatTime(entry.end_time)}\n${formatDuration(duration)}`}
                  >
                    <div className="time-entry-content">
                      <span className="time-entry-label">{entry.app_name}</span>
                      <span className="time-entry-duration">{formatDuration(duration)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

export default App;