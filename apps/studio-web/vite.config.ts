import { defineConfig } from "vite";

const repository = "tigpetryan-rgb/AI-Animation-Studio";
const developmentCommit = "0000000000000000000000000000000000000000";
const developmentSourceDate = "1970-01-01T00:00:00.000Z";

const buildCommit = process.env.AISTUDIO_SOURCE_SHA ?? developmentCommit;
const buildSourceDate = process.env.AISTUDIO_SOURCE_DATE ?? developmentSourceDate;

export default defineConfig({
  base: "./",
  define: {
    __AISTUDIO_BUILD_REPOSITORY__: JSON.stringify(repository),
    __AISTUDIO_BUILD_COMMIT__: JSON.stringify(buildCommit),
    __AISTUDIO_BUILD_SOURCE_DATE__: JSON.stringify(buildSourceDate),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
});
