import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'path';
import { viteSourceLocator } from '@metagptx/vite-plugin-source-locator';
import { atoms } from '@metagptx/web-sdk/plugins';
import { vitePrerenderPlugin } from 'vite-prerender-plugin';
import Sitemap from 'vite-plugin-sitemap';
import { getBlogRoutes } from './prerender/blog-routes.js';
import { getSitemapLastmod } from './prerender/blog-sitemap.js';

function escapeHtmlAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

process.env.VITE_APP_TITLE ??= process.env.OVERVIEW_TITLE ?? 'shadcnui';
process.env.VITE_APP_DESCRIPTION ??= process.env.OVERVIEW_DESCRIPTION ?? 'Atoms Generated Project';
process.env.VITE_APP_TITLE = escapeHtmlAttr(process.env.VITE_APP_TITLE);
process.env.VITE_APP_DESCRIPTION = escapeHtmlAttr(process.env.VITE_APP_DESCRIPTION);
process.env.VITE_APP_LOGO_URL ??= process.env.OVERVIEW_LOGO_URL ?? 'https://public-frontend-cos.metadl.com/mgx/img/favicon_atoms.ico';

/**
 * T31 部署溯源:把仓库提交信息注入构建产物,使「线上部署版本 ↔ 仓库 SHA」可追溯。
 * 取值优先级:CI 环境变量(GITHUB_SHA / VERCEL_GIT_COMMIT_SHA 等)→ 本地 git rev-parse HEAD → unknown。
 * 发布站点可在浏览器控制台执行 __ATOMS_BUILD__ 核对当前部署对应的提交。
 */
function resolveGitValue(args: string[], fallback: string): string {
  try {
    return execFileSync('git', args, { cwd: __dirname, encoding: 'utf8' }).trim() || fallback;
  } catch {
    return fallback;
  }
}

function resolveBuildInfo() {
  const env = process.env;
  // T35:显式注入优先(用于「以公开仓库 main 的实际提交作为构建输入重跑构建」的归因核验),
  // 其次 CI 环境变量,最后回退本地 git rev-parse HEAD
  const sha = (env.ATOMS_BUILD_SHA || env.GITHUB_SHA || env.VERCEL_GIT_COMMIT_SHA || env.CI_COMMIT_SHA || env.GIT_COMMIT
    || resolveGitValue(['rev-parse', 'HEAD'], 'unknown')).trim();
  const ref = (env.ATOMS_BUILD_REF || env.GITHUB_REF_NAME || env.VERCEL_GIT_COMMIT_REF || env.CI_COMMIT_REF_NAME
    || resolveGitValue(['rev-parse', '--abbrev-ref', 'HEAD'], 'unknown')).trim();
  return {
    sha,
    shortSha: sha === 'unknown' ? 'unknown' : sha.slice(0, 7),
    ref,
    builtAt: new Date().toISOString(),
  };
}

function ensureBuildOutDir() {
  let outDir = path.resolve(__dirname, 'dist');

  return {
    name: 'ensure-build-out-dir',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    // buildStart 阶段先创建输出目录,确保 sitemap 插件在 closeBundle
    // 写入 robots.txt/sitemap.xml 时目录一定存在。
    buildStart() {
      fs.mkdirSync(outDir, { recursive: true });
    },
    writeBundle() {
      fs.mkdirSync(outDir, { recursive: true });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  const blogPrerenderRoutes = command === 'build' ? getBlogRoutes() : [];
  const buildInfo = resolveBuildInfo();

  return {
    // T31:构建溯源标识(前端可读 __ATOMS_BUILD__)
    define: {
      __ATOMS_BUILD__: JSON.stringify(buildInfo),
    },
    plugins: [
      viteSourceLocator({
        prefix: 'mgx', // Prefix used to identify source locations; do not change.
      }),
      react(),
      atoms(),
      ensureBuildOutDir(),
      Sitemap({
        hostname: 'https://atoms.template.com',
        lastmod: getSitemapLastmod(),
        readable: true,
        generateRobotsTxt: true,
      }),
      ...(blogPrerenderRoutes.length > 0
        ? vitePrerenderPlugin({
            renderTarget: '#root',
            prerenderScript: path.resolve(__dirname, 'prerender/blog.js'),
            additionalPrerenderRoutes: blogPrerenderRoutes,
          })
        : []),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      host: '0.0.0.0', // Listen on all network interfaces.
      port: parseInt(process.env.VITE_PORT || '3000'),
      proxy: {
        '/api': {
          target: `http://localhost:${process.env.BACKEND_PORT || '8000'}`,
          changeOrigin: true,
        },
      },
      watch: { usePolling: true, interval: 600 },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            // Vendor chunks
            'react-vendor': ['react', 'react-dom'],
            'router-vendor': ['react-router-dom'],
            'ui-vendor': [
              '@radix-ui/react-accordion',
              '@radix-ui/react-alert-dialog',
              '@radix-ui/react-aspect-ratio',
              '@radix-ui/react-avatar',
              '@radix-ui/react-checkbox',
              '@radix-ui/react-collapsible',
              '@radix-ui/react-context-menu',
              '@radix-ui/react-dialog',
              '@radix-ui/react-dropdown-menu',
              '@radix-ui/react-hover-card',
              '@radix-ui/react-label',
              '@radix-ui/react-menubar',
              '@radix-ui/react-navigation-menu',
              '@radix-ui/react-popover',
              '@radix-ui/react-progress',
              '@radix-ui/react-radio-group',
              '@radix-ui/react-scroll-area',
              '@radix-ui/react-select',
              '@radix-ui/react-separator',
              '@radix-ui/react-slider',
              '@radix-ui/react-slot',
              '@radix-ui/react-switch',
              '@radix-ui/react-tabs',
              '@radix-ui/react-toast',
              '@radix-ui/react-toggle',
              '@radix-ui/react-toggle-group',
              '@radix-ui/react-tooltip',
            ],
            'form-vendor': ['react-hook-form', '@hookform/resolvers', 'zod'],
            'utils-vendor': [
              'axios',
              'clsx',
              'tailwind-merge',
              'class-variance-authority',
              'date-fns',
              'lucide-react',
            ],
            'query-vendor': ['@tanstack/react-query'],
          },
        },
      },
      chunkSizeWarningLimit: 1000,
    },
  };
});
