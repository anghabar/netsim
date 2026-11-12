# NetSim Community Edition

<div align="center">
  <img src="public/logo.png" alt="NetSim Logo" width="120" />
  <h1>The Open Source Network Simulator</h1>

  [![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg?style=flat-square)](https://www.gnu.org/licenses/agpl-3.0)
  [![Version](https://img.shields.io/badge/version-1.1.0-blue.svg?style=flat-square)](https://github.com/anghabar/netsim/releases)
  [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](CONTRIBUTING.md)
  [![Rust](https://img.shields.io/badge/Engine-Rust/WASM-orange?style=flat-square&logo=rust)](https://www.rust-lang.org/)
  [![TypeScript](https://img.shields.io/badge/UI-TypeScript-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)

  <p>
    <strong>Engineered for High-Performance Network Labs.</strong><br>
    A deterministic simulation engine written in <b>Rust</b> and compiled to <b>WebAssembly</b>.<br>
    Zero virtualization. Zero latency. 100% Browser-native.
  </p>

  [**Releases**](https://github.com/anghabar/netsim/releases) • [**Report Bug**](https://github.com/anghabar/netsim/issues) • [**Request Feature**](https://github.com/anghabar/netsim/issues)
</div>

---

## 🚀 Overview

**NetSim Community Edition** is an open-source network simulator that runs entirely in your browser. Starting with **v1.1.0**, the core simulation logic has been migrated from TypeScript to **Rust/WebAssembly** to achieve near-native execution speeds and deterministic protocol behavior.

It provides a high-performance, client-side network simulation environment that runs entirely in your browser, bypassing the need for heavy VMs or backend servers.

<div align="center">
  <img src="docs/images/netsim-dashboard.png" alt="NetSim Dashboard" width="100%" style="border-radius: 8px; border: 1px solid #333;" />
</div>

---

## ✨ Key Features (v1.1.0 WASM Core)

* **🦀 Rust-Powered Engine:** High-performance core handling packet switching and complex routing logic with memory safety.
* **🌐 100% Client-Side:** Runs entirely in your browser using WebAssembly. Zero latency, zero data egress.
* **🔌 Multi-Vendor CLI:** Native support for Cisco (IOS) and Huawei (VRP) command syntaxes.
* **🔒 Privacy First:** Your topologies and configurations never leave your machine.
* **🔋 Built-in Labs:** Ready-to-use scenarios for STP, OSPF, and VLAN practice.
* **🛠️ Modern Stack:** Built with React 19, Rust, and React Flow.

---

## 👀 Visuals

<div align="center">
  <img src="docs/images/netsim-lab-session.png" alt="NetSim Lab Session" width="100%" style="border-radius: 8px; border: 1px solid #333; margin-top: 10px; margin-bottom: 20px;" />
</div>

---

## 📦 Quick Start

### Prerequisites

* **Node.js** 20.19+ or 22.12+ (required by the Vite 7 toolchain) with npm.
* **Rust** stable toolchain, installed with [rustup](https://rustup.rs/).
* **[wasm-pack](https://rustwasm.github.io/wasm-pack/installer/)**, used to compile the core to WebAssembly.

### Run it locally

```bash
# 1. Clone the repository
git clone https://github.com/anghabar/netsim.git

# 2. Enter the directory
cd netsim

# 3. Install the JavaScript dependencies
npm install

# 4. Build the WebAssembly core
#    (needed before the first run and after every change in wasm-core/)
npm run build:wasm

# 5. Start the development server
npm run dev
```

The development server prints the local address to open (by default `http://localhost:5173`).

### Scripts

| Command | What it does |
| :--- | :--- |
| `npm run build:wasm` | Compiles `wasm-core/` to WebAssembly with `wasm-pack` into `src/wasm/pkg`. |
| `npm run dev` | Starts the Vite development server. |
| `npm test` | Runs the unit tests with Vitest. |
| `npm run typecheck` | Type-checks the TypeScript sources. |
| `npm run lint` | Runs ESLint over the project. |
| `npm run build` | Builds the WebAssembly core and the production bundle into `dist/`. |

The Rust tests run with `cargo test --manifest-path wasm-core/Cargo.toml`.

## 🏗️ Architecture

NetSim utilizes a decoupled architecture where a high-speed Rust core manages the network state, exposed to a React frontend via a typed WebAssembly bridge.

| Layer | Technology | Description |
| :--- | :--- | :--- |
| **Core Engine** | Rust + WASM | Logic for OSPF, BGP, STP, and CLI parsing. |
| **State Management** | Zustand | Syncs the WASM state with the UI components. |
| **Visualization** | React Flow | Interactive node-based topology editor. |
| **Interface** | Tailwind CSS | Responsive, dark-themed professional UI. |

## 🔒 Privacy

NetSim is designed to run entirely in your browser: there is no account, no server and no telemetry or analytics. Topologies, lab progress and settings are kept in memory and in your browser's local storage, and they leave your machine only when you export a file yourself. Anything that breaks this promise is treated as a security issue; see [SECURITY.md](SECURITY.md).

## 🛡️ Security

Please report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md). Do not open a public issue for a suspected security problem.

## 🤝 Contributing & Governance

We welcome contributions! Please follow these steps:
1.  Read our [Code of Conduct](CODE_OF_CONDUCT.md) to maintain a professional environment.
2.  Read the [contributing guide](CONTRIBUTING.md): it covers the development setup, the checks to run before a pull request and the project policies.
3.  Fork the repo and create your branch as `<type>/<topic-in-english>`.
4.  Run the checks listed in the contributing guide, including `cargo test` for the Rust core.
5.  Open a Pull Request.

## 📄 License

NetSim is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). See [LICENSE](LICENSE).
