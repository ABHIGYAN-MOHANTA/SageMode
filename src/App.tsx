import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

function App() {
  const [cpuUsage, setCpuUsage] = useState<number>(0);
  const [memoryUsage, setMemoryUsage] = useState<number>(0);

  useEffect(() => {
    const fetchSystemInfo = async () => {
      try {
        const [cpu, memory] = await Promise.all([
          invoke<number>("get_cpu_usage"),
          invoke<number>("get_memory_usage")
        ]);
        setCpuUsage(cpu);
        setMemoryUsage(memory);
      } catch (error) {
        console.error("Failed to fetch system info:", error);
      }
    };

    // Update system info every second
    const interval = setInterval(fetchSystemInfo, 1000);
    fetchSystemInfo(); // Initial fetch

    return () => clearInterval(interval);
  }, []);

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
    </main>
  );
}

export default App;
