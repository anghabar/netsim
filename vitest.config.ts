import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

const SRC_DIR = fileURLToPath(new URL('./src', import.meta.url));

/**
 * Suites written for the Node.js built-in test runner (`node:test`).
 *
 * Vitest cannot collect them: a file that registers no Vitest suite fails the
 * run. They stay in the tree, excluded here and in tsconfig.vitest.json, until
 * each one is migrated to Vitest or removed. Keep both lists in sync and
 * delete an entry as soon as its file is migrated.
 */
const LEGACY_NODE_RUNNER_SUITES: readonly string[] = [
  'src/tests/PingCommand.test.ts',
  'src/tests/cliAcl.test.ts',
  'src/tests/cliCisco.test.ts',
  'src/tests/cliExport.test.ts',
  'src/tests/cliFlows.test.ts',
  'src/tests/cliHelpers.test.ts',
  'src/tests/cliProfiles.test.ts',
  'src/tests/cliStp.test.ts',
  'src/tests/logic.test.ts',
  'src/tests/schemaMigrations.test.ts',
  'src/tests/topology-logic.test.ts',
  'src/tests/topology.test.ts',
  'src/tests/integration/CliTopologyIntegration.test.ts'
];

export default defineConfig({
  resolve: {
    alias: {
      '@': SRC_DIR
    }
  },
  test: {
    // Domain modules are framework-free, so the suites run in plain Node.js.
    environment: 'node',
    // Test APIs are imported explicitly from 'vitest'.
    globals: false,
    include: ['src/tests/**/*.test.ts'],
    exclude: [...configDefaults.exclude, ...LEGACY_NODE_RUNNER_SUITES],
    // Stubs the WebAssembly bridge and blocks every network API.
    setupFiles: ['./src/tests/setup/vitest.setup.ts'],
    passWithNoTests: false
  }
});
