import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { loadRuntimeConfig } from './lib/config.ts';

// Load runtime configuration before rendering the app
async function initializeApp() {
  // Prerendered blog pages are served as pure static HTML for SEO.
  // Intentionally skip React mounting so the crawler-facing markup stays
  // lightweight and self-contained — no client-side hydration needed.
  if (
    document
      .querySelector('meta[name="prerender-static-page"]')
      ?.getAttribute('content') === 'blog'
  ) {
    return;
  }

  try {
    await loadRuntimeConfig();
    console.log('Runtime configuration loaded successfully');
  } catch (error) {
    console.warn(
      'Failed to load runtime configuration, using defaults:',
      error
    );
  }

  // T31 部署溯源:把构建期注入的提交信息暴露到控制台与 window,
  // 便于核对「已发布站点 ↔ 仓库提交」的对应关系(浏览器控制台执行 __ATOMS_BUILD__)。
  try {
    const build = __ATOMS_BUILD__;
    (window as unknown as Record<string, unknown>).__ATOMS_BUILD__ = build;
    console.info(
      `[atoms] build ${build.shortSha} @ ${build.ref} (${build.builtAt})`
    );
  } catch {
    /* 构建标识缺失不影响运行 */
  }

  // Render the app
  createRoot(document.getElementById('root')!).render(<App />);
}

// Initialize the app
initializeApp();
