import { useState, useEffect } from "react";
import reactLogo from "./assets/react.svg";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

function App() {
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");
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

  async function greet() {
    // Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
    setGreetMsg(await invoke("greet", { name }));
  }

  return (
    <main className="container">
      <h1>SageMode</h1>

      <div className="row">
        <div className="system-metrics">
          <div className="metric">
            <div className="cpu-header">
              <h2>CPU Usage</h2>
              <p>{cpuUsage.toFixed(1)}%</p>
            </div>
            <div className="cpu-bar">
              <div 
                className="cpu-bar-fill" 
                style={{ width: `${cpuUsage}%` }}
              />
            </div>
          </div>

          <div className="metric">
            <div className="cpu-header">
              <h2>Memory Usage</h2>
              <p>{memoryUsage.toFixed(1)}%</p>
            </div>
            <div className="cpu-bar">
              <div 
                className="cpu-bar-fill" 
                style={{ width: `${memoryUsage}%` }}
              />
            </div>
          </div>
        </div>
      </div>
      <p>Click on the Tauri, Vite, and React logos to learn more.</p>

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          greet();
        }}
      >
        <input
          id="greet-input"
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="Enter a name..."
        />
        <button type="submit">Greet</button>
      </form>
      <p>{greetMsg}</p>
    </main>
  );
}

export default App;
