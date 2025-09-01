import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    silent: true, // テスト出力を静かにする
    watch: false, // watchの挙動がAIコーディングと相性が悪いためデフォルトでdisableにする
    projects: [
      {
        test: {
          environment: "jsdom",
          include: ["tests/frontend/**/*.test.ts"],
        },
      },
      {
        test: {
          environment: "node",
          include: ["tests/backend/**/*.test.ts"],
        },
      },
    ],
  },
});
