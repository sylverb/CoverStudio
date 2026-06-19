import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub project pages: https://<user>.github.io/CoverStudio/
export default defineConfig({
  base: "/CoverStudio/",
  plugins: [react()],
  build: {
    outDir: "dist",
  },
});
