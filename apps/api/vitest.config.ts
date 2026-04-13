import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    globals: true,
    env: {
      JWT_SECRET: "test-secret-for-vitest-do-not-use-in-production",
    },
    setupFiles: ["./src/shared/tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/shared/tests/**",
        "src/index.ts",
        "**/*.d.ts",
        "prisma/**",
      ],
      thresholds: {
        lines: 75,
        functions: 75,
        branches: 70,
        statements: 75,
      },
    },
    include: ["src/**/*.{test,spec}.ts"],
    // Integration tests hit a real test database — run sequentially to avoid
    // connection pool exhaustion and race conditions between test files.
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: false,
      },
    },
  },
});
