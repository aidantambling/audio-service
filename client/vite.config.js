import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => {
  if (command === "serve") {
    // Development (localhost:5173 → backend:5000)
    return {
      plugins: [react()],
      server: {
        proxy: {
          "/api": "http://localhost:5000",
        },
      },
    };
  } else {
    // Production build (served by backend itself)
    return {
      plugins: [react()],
    };
  }
});
