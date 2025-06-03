import { useState, useEffect, useRef } from "react";
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

interface CategoryUsage {
  category: string;
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
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const timelineContainerRef = useRef<HTMLDivElement>(null);

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

  // Custom tooltip for category pie chart
  const CategoryPieTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const entry = payload[0].payload;
      return (
        <div style={{ background: '#222', color: '#fff', padding: 8, borderRadius: 6, border: 'none' }}>
          <div><strong>{entry.category}</strong></div>
          <div>Time Spent: {formatDuration(entry.totalDuration)}</div>
          <div style={{ fontSize: '0.8em', color: '#aaa', marginTop: '4px' }}>
            {entry.category === 'Code' && 'Development and coding activities'}
            {entry.category === 'Meetings' && 'Communication and collaboration'}
            {entry.category === 'Explore' && 'Web browsing and research'}
            {entry.category === 'Productivity' && 'Document and content creation'}
            {entry.category === 'Other' && 'Miscellaneous applications'}
          </div>
        </div>
      );
    }
    return null;
  };

  useEffect(() => {
    const fetchSystemInfo = async () => {
      try {
        const [cpu, memory, _, entries] = await Promise.all([
          invoke<number>("get_cpu_usage"),
          invoke<number>("get_memory_usage"),
          invoke<ProcessInfo[]>("get_active_processes"),
          invoke<TimeEntry[]>("get_time_entries")
        ]);
        setCpuUsage(cpu);
        setMemoryUsage(memory);
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

  // Scroll to current time on mount and every 30 seconds
  useEffect(() => {
    const scrollToNow = () => {
      if (timelineContainerRef.current) {
        const now = Math.floor(Date.now() / 1000);
        const top = getTimePosition(now);
        timelineContainerRef.current.scrollTop = Math.max(top - timelineContainerRef.current.clientHeight / 2, 0);
      }
    };
    scrollToNow(); // On mount
    const interval = setInterval(scrollToNow, 30000); // Every 30 seconds
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

  // Helper function to filter entries for today
  const getTodayEntries = (entries: TimeEntry[]): TimeEntry[] => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStart = Math.floor(today.getTime() / 1000);
    const tomorrowStart = todayStart + 24 * 60 * 60;

    return entries.filter(entry => 
      entry.start_time >= todayStart && entry.start_time < tomorrowStart
    );
  };

  const getAggregatedAppUsage = (entries: TimeEntry[]): AppUsage[] => {
    const todayEntries = getTodayEntries(entries);
    const usageMap = new Map<string, number>();
    
    todayEntries.forEach(entry => {
      const duration = entry.end_time - entry.start_time;
      const currentTotal = usageMap.get(entry.app_name) || 0;
      usageMap.set(entry.app_name, currentTotal + duration);
    });

    return Array.from(usageMap.entries())
      .map(([name, totalDuration]) => ({ name, totalDuration }))
      .sort((a, b) => b.totalDuration - a.totalDuration);
  };

  const CATEGORY_COLORS = {
    'Productivity': '#A29BFE', // Soft Lavender
    'Code': '#6C5CE7',         // Rich Indigo
    'Meetings': '#B388EB',     // Light Purple
    'Explore': '#D3CCE3',      // Muted Gray-Lavender (low contrast)
    'Other': '#636e72'         // Desaturated Gray
  };

  // Function to categorize apps
  const categorizeApp = (appName: string): string => {
    const lowerName = appName.toLowerCase();

    const codeKeywords = [
      'code', 'studio', 'terminal', 'git', 'xcode', 'sublime', 'atom', 'vim', 'emacs', 'neovim',
      'intellij', 'webstorm', 'pycharm', 'clion', 'goland', 'rider', 'rubymine', 'datagrip', 'appcode',
      'android studio', 'cursor', 'nova', 'bbedit', 'brackets', 'eclipse', 'netbeans'
    ];

    const meetingKeywords = [
      'meet', 'zoom', 'teams', 'slack', 'skype', 'webex', 'bluejeans', 'discord', 'google meet',
      'facetime', 'gotomeeting', 'whereby', 'ringcentral', 'zoho meeting'
    ];

    const exploreKeywords = [
      'chrome', 'safari', 'firefox', 'brave', 'arc', 'opera', 'vivaldi', 'edge', 'duckduckgo'
    ];

    const productivityKeywords = [
      'notes', 'word', 'excel', 'powerpoint', 'docs', 'sheets', 'slides', 'onenote', 'notion',
      'obsidian', 'bear', 'evernote', 'simplenote', 'apple notes', 'pages', 'numbers', 'keynote',
      'todoist', 'things', 'ticktick', 'goodnotes', 'pdf expert', 'preview', 'sagemode'
    ];

    const matches = (keywords: string[]) => keywords.some(keyword => lowerName.includes(keyword));

    if (matches(codeKeywords)) return 'Code';
    if (matches(meetingKeywords)) return 'Meetings';
    if (matches(exploreKeywords)) return 'Explore';
    if (matches(productivityKeywords)) return 'Productivity';
    return 'Other';
  };

  const getCategoryUsage = (entries: TimeEntry[]): CategoryUsage[] => {
    const todayEntries = getTodayEntries(entries);
    const usageMap = new Map<string, number>();
    
    todayEntries.forEach(entry => {
      const duration = entry.end_time - entry.start_time;
      const category = categorizeApp(entry.app_name);
      const currentTotal = usageMap.get(category) || 0;
      usageMap.set(category, currentTotal + duration);
    });

    return Array.from(usageMap.entries())
      .map(([category, totalDuration]) => ({ category, totalDuration }))
      .sort((a, b) => b.totalDuration - a.totalDuration);
  };

  // Move calculateXP inside App component - ensure it's defined after its dependencies
  const calculateXP = (entries: TimeEntry[]): number => {
    let xp = 0;

    entries.forEach((entry: TimeEntry) => {
      const duration = entry.end_time - entry.start_time; // seconds
      const category = categorizeApp(entry.app_name);

      const minutes = duration / 60;
      if (category === 'Code') xp += minutes * 3;
      else if (category === 'Productivity') xp += minutes * 2;
      else if (category === 'Meetings') xp += minutes * 1.5;
      else if (category === 'Explore') xp += minutes * 1;
      else xp += minutes * 0.1;
    });

    return Math.floor(xp);
  };

  const xp = calculateXP(timeEntries); // Add XP calculation

  // Layout the time entries to avoid overlap - only filter SageMode and use today's entries
  const layoutEntries = layoutTimeEntries(
    getTodayEntries(timeEntries).filter(entry => entry.app_name.toLowerCase() !== 'sagemode')
  );

  // Add color palette for pie chart
  const COLORS = [
    '#6C5CE7', // Deep Indigo (Code)
    '#A29BFE', // Light Lavender (Productivity)
    '#B388EB', // Muted Purple (Meetings)
    '#9C89B8', // Warm Lilac
    '#8E8DFF', // Blue-Lavender
    '#7E75F9', // Electric Violet
    '#7D5FFF', // Soft Vivid Indigo
    '#6D6875', // Desaturated Plum
    '#B5838D', // Dusty Rose
    '#FFCDB2', // Warm Peach
    '#A28FD0', // Pale Purple (used in Rize)
    '#C3B1E1', // Light Orchid
    '#A3A1FB', // Periwinkle Blue
    '#BFA2DB', // Subtle Purple Gray
    '#5E548E', // Twilight Purple
    '#9381FF'  // Gentle Indigo Accent
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
        <div className="tab-bar-right">
          <div className="xp-bar">
            <span>Chakra</span>
            <div className="xp-progress">
              <div
                className="xp-progress-fill"
                style={{ width: `${Math.min(xp % 100, 100)}%` }}
              />
            </div>
            <span>{xp % 100}/100</span>
          </div>
          <div className="sage-level">
            <span>Sage Level</span>
            <span className="sage-level-value">{Math.floor(xp / 100)}</span>
          </div>
        </div>
      </div>

      <div className="main-content">
        <div className="process-list">
          <h2>Today's App Usage</h2>
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
          <h2 style={{ marginTop: '1rem' }}>Today's Usage Distribution</h2>
          {/* Pie Charts Container */}
          <div className="pie-charts-container">
            {/* App Usage Pie Chart */}
            <div className="pie-chart-wrapper">
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
                    isAnimationActive={false}
                  >
                    {getAggregatedAppUsage(timeEntries).map((_, idx) => (
                      <Cell key={`cell-${idx}`} fill={COLORS[idx % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    content={PieTooltip}
                    wrapperStyle={{ outline: 'none' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            {/* Category Usage Pie Chart */}
            <div className="pie-chart-wrapper">
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={getCategoryUsage(timeEntries)}
                    dataKey="totalDuration"
                    nameKey="category"
                    cx="50%"
                    cy="50%"
                    outerRadius={70}
                    fill="#8884d8"
                    isAnimationActive={false}
                  >
                    {getCategoryUsage(timeEntries).map((entry) => (
                      <Cell key={`cell-${entry.category}`} fill={CATEGORY_COLORS[entry.category as keyof typeof CATEGORY_COLORS]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    content={CategoryPieTooltip}
                    wrapperStyle={{ outline: 'none' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="calendar-view">
          <h2>Today's Activity</h2>
          <div className="timeline-container" ref={timelineContainerRef}>
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