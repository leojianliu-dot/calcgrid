import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base must match the GitHub Pages sub-path: https://<user>.github.io/calcgrid/
export default defineConfig({
  base: "/calcgrid/",
  plugins: [react()],
});
