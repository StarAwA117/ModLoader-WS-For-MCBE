import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
	plugins: [vue()],
	build: {
		outDir: "dist",
		emptyOutDir: true,
		rollupOptions: {
			output: {
				manualChunks: {
					vendor: ["vue", "vue-router"]
				}
			}
		}
	},
	server: {
		proxy: {
			"/api": "http://127.0.0.1:18889"
		}
	}
});
