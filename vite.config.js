import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  },
  watch: {
    // AI 去背景模型文件体积大且由脚本下载，不纳入 HMR 监视
    ignored: ["**/public/models/**"],
  },
});