# SageMode

SageMode is a modern desktop application that helps you track and analyze your computer usage patterns. Built with React, TypeScript, and Tauri, it provides real-time insights into your application usage, helping you understand and optimize your digital habits.

## Features

- **Real-time System Monitoring**
  - CPU usage tracking
  - Memory usage monitoring
  - Active process tracking

- **Application Usage Analytics**
  - Detailed daily app usage statistics
  - Time tracking for each application
  - Visual timeline of application usage
  - Interactive pie charts for usage distribution

- **Smart Categorization**
  - Automatic categorization of applications into:
    - Code (Development tools)
    - Meetings (Communication apps)
    - Explore (Web browsers)
    - Productivity (Document and note-taking apps)
    - Other (Miscellaneous applications)

- **Beautiful Visualization**
  - Interactive timeline view
  - Usage distribution pie charts
  - Real-time system metrics
  - Clean, modern UI with dark theme

## Installation

### Quick Start (macOS)
1. Download the latest release (v0.1.0) for macOS ARM from the [Releases](https://github.com/ABHIGYAN-MOHANTA/SageMode/releases) section
2. Open the downloaded `.dmg` file
3. Drag SageMode to your Applications folder
4. Launch SageMode from your Applications folder

> Note: Currently, the release is available for macOS ARM (Apple Silicon) devices. Support for Intel Macs and other platforms will be added in future releases.

### Development Setup
If you want to build from source:

#### Prerequisites
- Node.js (v16 or later)
- Rust (for Tauri development)
- macOS (for building macOS version)

#### Steps
1. Clone the repository:
   ```bash
   git clone https://github.com/ABHIGYAN-MOHANTA/SageMode.git
   cd SageMode
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run tauri dev
   ```

### Building for Production
To create a production build:
```bash
npm run tauri build
```

The built application will be available in the `src-tauri/target/release` directory.

## Usage

1. Launch SageMode
2. The application will automatically start tracking your application usage
3. View your usage statistics in the main dashboard:
   - Top bar shows real-time CPU and Memory usage
   - Daily app usage list shows time spent in each application
   - Pie charts display usage distribution by application and category
   - Timeline view shows your activity throughout the day

## Technology Stack

- **Frontend**
  - React
  - TypeScript
  - Recharts (for data visualization)
  - CSS Modules

- **Backend**
  - Tauri (Rust-based desktop framework)
  - System monitoring APIs

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. You can also:
- Report bugs by opening an issue
- Suggest new features
- Improve documentation

Visit our [GitHub repository](https://github.com/ABHIGYAN-MOHANTA/SageMode) to get started.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Built with [Tauri](https://tauri.app/)
- Charts powered by [Recharts](https://recharts.org/)
- Icons and design inspiration from various open-source projects