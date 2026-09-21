/// <reference types="vite/client" />

/**
 * T31 部署溯源:构建期由 vite.config.ts 注入(见 define),把线上部署产物与仓库提交绑定。
 * 发布站点可在控制台执行 __ATOMS_BUILD__ 核对部署版本对应的提交 SHA。
 */
declare const __ATOMS_BUILD__: {
  /** 仓库提交 SHA(CI 提供 GITHUB_SHA / VERCEL_GIT_COMMIT_SHA,本地回退 git rev-parse HEAD) */
  sha: string;
  /** 提交 SHA 短号(7 位) */
  shortSha: string;
  /** 当前 Git 分支或 ref 名 */
  ref: string;
  /** 构建时间(ISO 字符串) */
  builtAt: string;
};
