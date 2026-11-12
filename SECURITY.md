# Security Policy

NetSim Community Edition is a browser-only application. It has no server component, no accounts and no telemetry: everything runs in the tab that loaded it, and state is kept in memory and in the browser's local storage. This policy explains which versions receive security fixes, how to report a vulnerability privately and what counts as a vulnerability for an application of this kind.

## Supported versions

Security fixes are released for the latest minor version only. Fixes land on the `main` branch first and are then published as a new release.

| Version | Security fixes |
| :--- | :--- |
| 1.1.x (latest release) | Yes |
| Older than 1.1 | No, please upgrade |

When a new minor version is released it becomes the supported one.

## Reporting a vulnerability

Report vulnerabilities **privately** through GitHub private vulnerability reporting:

<https://github.com/anghabar/netsim/security/advisories/new>

Please do not open a public issue, discussion or pull request for a suspected vulnerability, and do not include exploit details in public comments. Private vulnerability reporting is the only channel for security reports; there is no e-mail address for them.

A useful report contains:

- the affected version or commit, and the browser and operating system you used;
- step-by-step instructions to reproduce the problem, ideally with a minimal topology file, lab or sequence of CLI commands;
- what an attacker gains (script execution, data leaving the browser, corrupted saved state, and so on);
- a suggested fix, if you have one.

Use only made-up values in your report (for example `example.com` or addresses from `192.0.2.0/24`). Do not attach real device configurations or credentials.

If you are unsure whether something is a security problem, report it privately anyway.

## Scope

### In scope

- **Script or markup injection** through anything the application renders: device names, CLI output, lab content, imported files, pasted text or values read back from browser storage.
- **Object-property injection (for example via `__proto__`) or code execution** triggered by imported files, clipboard content or stored data.
- **Data leaving the browser.** Any network request that carries topology, configuration or usage data, and any form of telemetry, breaks the project's privacy promise and is handled as a vulnerability.
- **Saved state that breaks the application.** Crafted input (a file, a lab, a command) that is persisted and leaves the application unusable on the next load, or that makes the WebAssembly core misbehave beyond a single failed command.
- **Downloads and exports** that use unsanitised file names or include data the user was not told about.
- **Supply chain.** Malicious or vulnerable dependencies that end up in the shipped bundle, and weaknesses in this repository's build scripts, container file or CI workflows.

### Out of scope

- Attacks that need a compromised browser or operating system, a malicious browser extension, or direct access to the user's browser profile. Local storage is not encrypted and is readable by anyone with that access.
- Actions that require the user to run code in their own developer tools.
- **Simulation fidelity.** Simulated ACLs, NAT, firewalls and passwords are teaching aids, not security controls. A simulated device that behaves differently from real equipment is a regular bug: please open a normal issue.
- Slowness or a crashed tab caused by a very large topology that you built yourself.
- The configuration of any website that hosts a build of NetSim (TLS, HTTP headers, access control). This repository ships only the client application; contact the operator of that site.
- Dependency findings with no practical impact on the shipped application (for example, in development-only tools). These are welcome as normal issues or pull requests.
- Automated scanner output without a demonstrated impact.

## What to expect

NetSim is maintained by volunteers, so we do not promise fixed response or fix times. What we commit to:

- **Acknowledgement.** We acknowledge every report made through the private channel, on a best-effort basis. If you have not heard back after a reasonable time, add a comment to the same private report.
- **Assessment.** We tell you whether we consider the report a vulnerability and why, and we keep you informed while we work on it.
- **Coordinated disclosure.** We prepare the fix privately, agree a disclosure date with you and publish a GitHub security advisory together with the fixed release. We ask you not to disclose the problem before that date.
- **Credit.** We credit you in the advisory unless you prefer to stay anonymous.

There is no bug bounty programme.

## Good-faith research

Please test against your own local copy of the application. Do not test against websites operated by other people without their permission, and do not access or modify data that is not yours.

## Advice for users

- Do not type real credentials or production configuration into simulated devices. Saved topologies are stored unencrypted in your browser's local storage.
- Exported files contain what you configured, including values such as simulated passwords. Review a file before sharing it.
- Only import topology files from sources you trust, and keep your copy of NetSim up to date.
