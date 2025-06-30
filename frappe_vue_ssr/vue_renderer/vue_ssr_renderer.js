#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { build, loadConfigFromFile } from "vite";
import vue from "@vitejs/plugin-vue";

// Check Node.js version requirement
checkNodeVersion();

/**
 * Production-grade Vue SSR Renderer following Nuxt/VitePress patterns
 * Uses proper entry files and build system for Vue SFC compilation
 */

class VueSSRRenderer {
  constructor() {
    this.cache = new Map();
    this.tempDir = path.join(process.cwd(), ".ssr_cache");
    this.currentApp = null; // Will be set dynamically based on component path
    this.publicDir = null; // Will be set dynamically based on component path
  }

  getAppFromComponentPath(componentPath) {
    // Extract app name from component path like /path/to/apps/wiki/www/component.vue
    const parts = componentPath.split(path.sep);
    const wwwIndex = parts.lastIndexOf("www");
    if (wwwIndex > 0) {
      return parts[wwwIndex - 1];
    }
    // Fallback: try to find app name from path structure
    const appsIndex = parts.lastIndexOf("apps");
    if (appsIndex >= 0 && appsIndex < parts.length - 1) {
      return parts[appsIndex + 1];
    }
    throw new Error(
      `Could not determine app name from component path: ${componentPath}`,
    );
  }

  ensurePublicDir(componentPath) {
    if (!this.currentApp) {
      this.currentApp = this.getAppFromComponentPath(componentPath);
      this.publicDir = path.join(
        process.cwd(),
        this.currentApp,
        "public",
        "ssr",
      );
    }

    // Ensure public SSR directory exists
    if (!fs.existsSync(this.publicDir)) {
      fs.mkdirSync(this.publicDir, { recursive: true });
    }
  }

  async loadViteConfig(componentPath) {
    // Look for vite.ssr.config.js in various locations
    const appRoot = path.join(process.cwd(), this.currentApp);
    const possibleConfigPaths = [
      path.join(appRoot, "vite.ssr.config.js"),
      path.join(process.cwd(), "vite.ssr.config.js"),
      path.join(path.dirname(componentPath), "vite.ssr.config.js"),
    ];

    for (const configPath of possibleConfigPaths) {
      if (fs.existsSync(configPath)) {
        try {
          const result = await loadConfigFromFile(
            { command: "build", mode: "development" },
            configPath,
          );
          if (result) {
            console.error(`📦 Using Vite config from: ${configPath}`);
            return result.config;
          }
        } catch (error) {
          console.error(
            `⚠️  Failed to load Vite config from ${configPath}:`,
            error.message,
          );
        }
      }
    }

    return null;
  }

  mergeViteConfig(baseConfig, overrides) {
    if (!baseConfig) {
      return overrides;
    }

    // Deep merge configuration, giving priority to overrides for critical SSR settings
    const merged = { ...baseConfig };

    // Always override these critical SSR settings
    if (overrides.build) {
      merged.build = { ...merged.build, ...overrides.build };
    }
    if (overrides.configFile !== undefined) {
      merged.configFile = overrides.configFile;
    }
    if (overrides.logLevel) {
      merged.logLevel = overrides.logLevel;
    }

    // Merge plugins - append custom plugins to base plugins
    if (baseConfig.plugins && overrides.plugins) {
      merged.plugins = [...(baseConfig.plugins || []), ...overrides.plugins];
    } else if (overrides.plugins) {
      merged.plugins = overrides.plugins;
    }

    // Merge define statements
    if (baseConfig.define || overrides.define) {
      merged.define = { ...baseConfig.define, ...overrides.define };
    }

    // Merge other properties
    Object.keys(overrides).forEach((key) => {
      if (
        !["build", "configFile", "logLevel", "plugins", "define"].includes(key)
      ) {
        merged[key] = overrides[key];
      }
    });

    return merged;
  }

  validateVueComponent(content, filePath) {
    const issues = [];

    // Check for basic SFC structure
    const templateMatch = content.match(
      /<template[^>]*>([\s\S]*?)<\/template>/,
    );
    const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/);

    if (!templateMatch && !scriptMatch) {
      issues.push("No <template> or <script> section found");
    }

    if (templateMatch) {
      const templateContent = templateMatch[1];

      // Check for common HTML issues
      const unclosedTags = [];
      const tagStack = [];
      const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9-]*)[^>]*>/g;
      let match;

      while ((match = tagRegex.exec(templateContent)) !== null) {
        const fullTag = match[0];
        const tagName = match[1].toLowerCase();

        if (fullTag.startsWith("</")) {
          // Closing tag
          if (
            tagStack.length === 0 ||
            tagStack[tagStack.length - 1] !== tagName
          ) {
            unclosedTags.push(`Unmatched closing tag: ${fullTag}`);
          } else {
            tagStack.pop();
          }
        } else if (!fullTag.endsWith("/>")) {
          // Opening tag (not self-closing)
          if (
            ![
              "img",
              "br",
              "hr",
              "input",
              "meta",
              "link",
              "area",
              "base",
              "col",
              "embed",
              "source",
              "track",
              "wbr",
            ].includes(tagName)
          ) {
            tagStack.push(tagName);
          }
        }
      }

      // Remaining tags in stack are unclosed
      tagStack.forEach((tag) => {
        unclosedTags.push(`Unclosed tag: <${tag}>`);
      });

      if (unclosedTags.length > 0) {
        issues.push(...unclosedTags);
      }
    }

    return issues;
  }

  /**
   * Create a temporary Vite project structure that can properly resolve dependencies
   * This approach mimics how Nuxt/Vite handles component dependencies
   */
  createViteProject(componentPath, tempDir, componentName) {
    const componentDir = path.dirname(componentPath);

    // Create a minimal package.json in temp directory for proper module resolution
    const packageJson = {
      name: `ssr-${componentName}`,
      version: "1.0.0",
      type: "module",
      dependencies: {
        vue: "^3.4.0",
        "@vue/server-renderer": "^3.4.0",
      },
    };

    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify(packageJson, null, 2),
    );

    // Create entry files that import from the original component location
    // This allows Vite to resolve all dependencies naturally
    const componentEntry = `import Component from '${componentPath.replace(/\\/g, "/")}';
export default Component;`;

    const appEntry = `import { createSSRApp } from 'vue';
import Component from './component.js';

export function createApp() {
    return createSSRApp(Component);
}`;

    const serverEntry = `import { createApp } from './app.js';
import { renderToString } from '@vue/server-renderer';

export async function render(serverData = {}) {
    const app = createApp();

    // Provide server data to the app
    if (Object.keys(serverData).length > 0) {
        app.provide('serverData', serverData);
        app.config.globalProperties.$serverData = serverData;
    }

    const html = await renderToString(app);
    return html;
}`;

    const clientEntry = `import { createApp } from './app.js';

// Get server data from global (will be injected via separate script tag)
const serverData = window.__SERVER_DATA__ || {};

const app = createApp();

// Add better hydration error handling
app.config.errorHandler = (err, instance, info) => {
    console.error('Vue Error:', err);
    console.error('Component instance:', instance);
    console.error('Error info:', info);
};

// Add hydration debugging
app.config.warnHandler = (msg, instance, trace) => {
    if (msg.includes('Hydration')) {
        console.warn('🔧 Vue Hydration Warning:', msg);
        console.warn('Component instance:', instance);
        console.warn('Component trace:', trace);
    } else {
        console.warn('Vue Warning:', msg);
    }
};

// Provide the same server data that was provided during SSR
if (Object.keys(serverData).length > 0) {
    app.provide('serverData', serverData);
    app.config.globalProperties.$serverData = serverData;
}

// Mount for hydration
try {
    app.mount('#app');
    console.log('✅ Vue SSR hydration completed successfully');

    // Dispatch custom event to indicate hydration complete
    window.dispatchEvent(new CustomEvent('vue:hydrated', {
        detail: { componentName: '${componentName}', serverData, success: true }
    }));
} catch (error) {
    console.error('❌ Vue SSR hydration failed:', error);

    window.dispatchEvent(new CustomEvent('vue:hydration-failed', {
        detail: { componentName: '${componentName}', error: error.message, serverData }
    }));
}`;

    // Write all entry files
    const files = {
      "component.js": componentEntry,
      "app.js": appEntry,
      "server.js": serverEntry,
      "client.js": clientEntry,
    };

    Object.entries(files).forEach(([filename, content]) => {
      fs.writeFileSync(path.join(tempDir, filename), content);
    });

    return {
      componentDir, // Original component directory for resolve.alias
      entries: {
        server: path.join(tempDir, "server.js"),
        client: path.join(tempDir, "client.js"),
      },
    };
  }

  async renderComponent(componentPath, serverData = {}) {
    try {
      // Ensure public directory exists for this app
      this.ensurePublicDir(componentPath);

      // Generate cache key based on component path and modification time
      const stat = fs.statSync(componentPath);
      const cacheKey = `${componentPath}-${stat.mtime.getTime()}`;

      // Check cache first
      if (this.cache.has(cacheKey)) {
        return await this.renderWithCachedBundle(
          this.cache.get(cacheKey),
          serverData,
        );
      }

      // Build the SSR bundle
      const bundleInfo = await this.buildSSRBundle(componentPath, cacheKey);
      this.cache.set(cacheKey, bundleInfo);

      return await this.renderWithCachedBundle(bundleInfo, serverData);
    } catch (error) {
      console.error("Vue SSR Error:", error);
      return this.createErrorResponse(error);
    }
  }

  async buildSSRBundle(componentPath, cacheKey) {
    const tempDir = path.join(
      this.tempDir,
      Buffer.from(cacheKey).toString("base64").replace(/[/+=]/g, "_"),
    );

    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const componentName = path.basename(componentPath, ".vue");

    // Load custom Vite configuration if available
    const customConfig = await this.loadViteConfig(componentPath);

    // Read and validate the original component
    let originalContent;
    try {
      originalContent = fs.readFileSync(componentPath, "utf-8");
    } catch (error) {
      throw new Error(
        `Could not read component file: ${componentPath} - ${error.message}`,
      );
    }

    // Validate Vue component structure
    const validationIssues = this.validateVueComponent(
      originalContent,
      componentPath,
    );
    if (validationIssues.length > 0) {
      console.error(`❌ Vue component validation failed for ${componentPath}:`);
      validationIssues.forEach((issue) => console.error(`   - ${issue}`));
      console.error("Component content preview:");
      console.error(originalContent.substring(0, 1000));
      throw new Error(
        `Invalid Vue component structure: ${validationIssues.join(", ")}`,
      );
    }

    // Create Vite project structure that can resolve dependencies naturally
    const viteProject = this.createViteProject(
      componentPath,
      tempDir,
      componentName,
    );
    const { componentDir, entries } = viteProject;

    // Build server bundle
    const serverOverrides = {
      configFile: false,
      logLevel: "warn",
      root: process.cwd(), // Use project root so Vite can find postcss.config.js
      build: {
        ssr: true,
        outDir: path.join(tempDir, "dist-server"),
        rollupOptions: {
          input: entries.server,
          output: {
            entryFileNames: "server.js",
            format: "es",
          },
          external: ["vue", "@vue/server-renderer"],
        },
        minify: false,
        target: "node16",
        sourcemap: false,
      },
      resolve: {
        alias: {
          // Allow Vite to resolve from the component's directory
          "@": componentDir,
          "~": componentDir,
        },
      },
      plugins: [
        vue({
          isProduction: false,
          script: {
            defineModel: true,
            propsDestructure: true,
          },
          template: {
            compilerOptions: {
              scopeId: `data-v-${componentName.toLowerCase()}`,
            },
          },
        }),
      ],
      define: {
        "process.env.NODE_ENV": '"development"',
        __VUE_OPTIONS_API__: true,
        __VUE_PROD_DEVTOOLS__: false,
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: true,
      },
      ssr: {
        noExternal: true,
      },
    };

    const serverConfig = this.mergeViteConfig(customConfig, serverOverrides);

    try {
      await build(serverConfig);
    } catch (error) {
      console.error(`❌ Server build failed for ${componentPath}`);
      console.error("Component directory:", componentDir);
      console.error("Server entry:", entries.server);
      if (fs.existsSync(componentPath)) {
        console.error("Component content preview:");
        const content = fs.readFileSync(componentPath, "utf-8");
        console.error(content.substring(0, 1000));
      }
      throw new Error(`Server build failed: ${error.message}`);
    }

    // Build client bundle
    const clientOverrides = {
      configFile: false,
      logLevel: "warn",
      root: process.cwd(), // Use project root so Vite can find postcss.config.js
      build: {
        outDir: path.join(tempDir, "dist-client"),
        rollupOptions: {
          input: entries.client,
          output: {
            entryFileNames: "client.js",
            format: "iife",
          },
        },
        minify: false,
        target: "es2020",
        sourcemap: false,
      },
      resolve: {
        alias: {
          // Allow Vite to resolve from the component's directory
          "@": componentDir,
          "~": componentDir,
        },
      },
      plugins: [
        vue({
          isProduction: false,
          script: {
            defineModel: true,
            propsDestructure: true,
          },
          template: {
            compilerOptions: {
              scopeId: `data-v-${componentName.toLowerCase()}`,
            },
          },
        }),
      ],
      define: {
        "process.env.NODE_ENV": '"development"',
        __VUE_OPTIONS_API__: true,
        __VUE_PROD_DEVTOOLS__: false,
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: true,
      },
      // Add optimizations for client bundle
      optimizeDeps: {
        include: ["vue"],
      },
    };

    const clientConfig = this.mergeViteConfig(customConfig, clientOverrides);

    try {
      await build(clientConfig);
    } catch (error) {
      console.error(`❌ Client build failed for ${componentPath}`);
      console.error("Component directory:", componentDir);
      console.error("Client entry:", entries.client);
      if (fs.existsSync(componentPath)) {
        console.error("Component content preview:");
        const content = fs.readFileSync(componentPath, "utf-8");
        console.error(content.substring(0, 1000));
      }
      throw new Error(`Client build failed: ${error.message}`);
    }

    return {
      tempDir,
      serverBundle: path.join(tempDir, "dist-server", "server.js"),
      clientBundle: path.join(tempDir, "dist-client", "client.js"),
      originalPath: componentPath,
      componentDir,
    };
  }

  async copyClientBundleToPublic(tempClientBundle, componentName) {
    const publicClientBundle = path.join(
      this.publicDir,
      `${componentName}-${Date.now()}.js`,
    );

    // Copy the client bundle to public directory for Frappe asset serving
    if (fs.existsSync(tempClientBundle)) {
      fs.copyFileSync(tempClientBundle, publicClientBundle);
      return publicClientBundle;
    }

    throw new Error(`Client bundle not found at ${tempClientBundle}`);
  }

  async renderWithCachedBundle(bundleInfo, serverData) {
    const { serverBundle, clientBundle, originalPath, componentDir } =
      bundleInfo;

    try {
      // Import the server bundle using dynamic import for ES modules
      const serverModule = await import(
        `file://${path.resolve(serverBundle)}?t=${Date.now()}`
      );
      const { render } = serverModule;

      if (!render) {
        throw new Error("Server bundle does not export a render function");
      }

      // Render to HTML string
      const html = await render(serverData);

      // Trim whitespace to prevent hydration mismatches
      const trimmedHtml = html.trim();

      // Copy client bundle to public directory for serving
      const componentName = path.basename(originalPath, ".vue");
      const publicClientBundle = await this.copyClientBundleToPublic(
        clientBundle,
        componentName,
      );

      // Extract styles from the original component
      const styles = this.extractStyles(originalPath);

      return {
        // html: trimmedHtml,
        html,
        styles,
        clientBundlePath: publicClientBundle,
        serverData: serverData,
        success: true,
      };
    } catch (error) {
      console.error("Bundle rendering error:", error);
      throw error;
    }
  }

  extractStyles(componentPath) {
    try {
      const content = fs.readFileSync(componentPath, "utf-8");
      const styleRegex = /<style(?:\s+[^>]*)?>([\s\S]*?)<\/style>/gi;
      const styles = [];
      let match;

      while ((match = styleRegex.exec(content)) !== null) {
        const styleContent = match[1].trim();
        if (styleContent) {
          styles.push(styleContent);
        }
      }

      return styles.join("\n\n");
    } catch (error) {
      console.warn("Could not extract styles:", error.message);
      return "";
    }
  }

  createErrorResponse(error) {
    return {
      html: `<div class="vue-ssr-error">
                <h3>Vue SSR Error</h3>
                <pre>${error.message}</pre>
                <details>
                    <summary>Stack trace</summary>
                    <pre>${error.stack}</pre>
                </details>
            </div>`,
      styles: `
                .vue-ssr-error {
                    background: #fee;
                    border: 1px solid #f88;
                    padding: 20px;
                    border-radius: 4px;
                    color: #c33;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                }
                .vue-ssr-error h3 {
                    margin-top: 0;
                    color: #a00;
                }
                .vue-ssr-error pre {
                    background: #f5f5f5;
                    padding: 10px;
                    border-radius: 3px;
                    overflow-x: auto;
                    font-size: 12px;
                }
            `,
      clientBundlePath: null,
      serverData: {},
      success: false,
      error: error.message,
    };
  }

  // Cleanup method
  cleanup() {
    // if (fs.existsSync(this.tempDir)) {
    //     fs.rmSync(this.tempDir, { recursive: true, force: true });
    // }
    this.cache.clear();
  }

  // Generate server data injection script
  generateServerDataScript(serverData) {
    return `window.__SERVER_DATA__ = ${JSON.stringify(serverData)};`;
  }

  // Get Frappe asset URL for serving client bundle
  getClientBundleUrl(clientBundlePath) {
    if (
      clientBundlePath &&
      this.currentApp &&
      clientBundlePath.includes(`${this.currentApp}/public/ssr`)
    ) {
      const fileName = path.basename(clientBundlePath);
      return `/assets/${this.currentApp}/ssr/${fileName}`;
    }

    // Fallback for other paths
    const relativePath = path.relative(process.cwd(), clientBundlePath);
    return "/" + relativePath.replace(/\\/g, "/");
  }
}

function checkNodeVersion() {
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1).split(".")[0]);

  if (majorVersion < 22) {
    console.error(`❌ Error: Node.js v22 or higher is required for Vue SSR.`);
    console.error(`   Current version: ${nodeVersion}`);
    process.exit(1);
  }
}

// Singleton instance
const renderer = new VueSSRRenderer();

// Main render function
async function renderVueComponent(componentPath, serverData = {}) {
  return await renderer.renderComponent(componentPath, serverData);
}

// Cleanup on process exit
process.on("exit", () => renderer.cleanup());
process.on("SIGINT", () => {
  renderer.cleanup();
  process.exit(0);
});

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error(
      "Usage: node vue_ssr_renderer.js <component-path> [server-data-json]",
    );
    process.exit(1);
  }

  const componentPath = args[0];
  const serverDataJson = args[1] || "{}";

  let serverData;
  try {
    serverData = JSON.parse(serverDataJson);
  } catch (e) {
    console.error("Invalid JSON for server data:", e.message);
    process.exit(1);
  }

  renderVueComponent(componentPath, serverData)
    .then((result) => {
      // Add helper URLs and scripts for easier integration
      if (result.success && result.clientBundlePath) {
        result.clientBundleUrl = renderer.getClientBundleUrl(
          result.clientBundlePath,
        );
        result.serverDataScript = renderer.generateServerDataScript(
          result.serverData,
        );
      }
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(
        JSON.stringify({
          success: false,
          error: error.message,
          html: `<div>Error: ${error.message}</div>`,
          styles: "",
          clientJS: "",
        }),
      );
      process.exit(1);
    });
}

export { renderVueComponent, VueSSRRenderer };
