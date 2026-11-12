// @ts-check
/**
 * 外壳用到的路径。数据目录先和核心一致，用 ~/.config/coopet（阶段 3 打包时再换成各系统的惯例位置）。
 */
const { homedir } = require('node:os');
const { join } = require('node:path');

/** 本包所在目录（开发时 Electron 以它为应用目录启动） */
const APP_ROOT = __dirname;
/** 核心包目录：核心子进程以它为工作目录，tsx 才会读到它的 tsconfig（cortico/* 路径映射） */
const CORE_ROOT = join(APP_ROOT, '..', 'coopet-core');
const DATA_DIR = process.env.COOPET_DATA_DIR || join(homedir(), '.config', 'coopet');

module.exports = {
  APP_ROOT,
  CORE_ROOT,
  CORE_ENTRY: join(CORE_ROOT, 'src', 'main.ts'),
  DATA_DIR,
  LOGS_DIR: join(DATA_DIR, 'logs'),
  /** Electron 自己的数据（Chromium 配置、单实例锁），与桌宠窗口进程分开 */
  ELECTRON_DATA_DIR: join(DATA_DIR, 'electron'),
};
