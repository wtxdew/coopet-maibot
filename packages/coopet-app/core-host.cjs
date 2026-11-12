// @ts-check
/**
 * 启动并看住核心子进程（coopet-core/src/main.ts）。
 *
 * - 启动：用 Electron 自己的程序以 Node 模式运行（ELECTRON_RUN_AS_NODE=1），`--import tsx` 直接跑 TypeScript；
 *   工作目录是核心包，tsx 才会读到它的 tsconfig。主进程与核心之间用 Node 的 IPC（process.send）互发 JSON。
 * - 崩溃重启：意外退出后等 3 秒再启动；5 分钟内超过 5 次就放弃（状态 failed）。
 * - 停止：先发 SIGTERM（核心会停 link、关桌宠窗口、写回配置），5 秒没退就 SIGKILL。
 *
 * 事件：`message`（核心发来的消息）、`state`（'starting' | 'running' | 'restarting' | 'failed' | 'stopped'）。
 */
const { fork: nodeFork } = require('node:child_process');
const { EventEmitter } = require('node:events');

const RESTART_DELAY_MS = 3000;
const CRASH_WINDOW_MS = 5 * 60_000;
const MAX_CRASHES = 5;
const STOP_TIMEOUT_MS = 5000;

/**
 * @typedef {'stopped' | 'starting' | 'running' | 'restarting' | 'failed'} CoreState
 * @typedef {{
 *   entry: string,
 *   cwd: string,
 *   execPath: string,
 *   env: NodeJS.ProcessEnv,
 *   fork?: typeof nodeFork,
 *   setTimeout?: (fn: () => void, ms: number) => unknown,
 *   clearTimeout?: (handle: any) => void,
 *   now?: () => number,
 *   log?: (msg: string) => void,
 * }} CoreHostOptions
 */

class CoreHost extends EventEmitter {
  /** @param {CoreHostOptions} opts */
  constructor(opts) {
    super();
    this.opts = opts;
    this._fork = opts.fork ?? nodeFork;
    /** @type {(fn: () => void, ms: number) => unknown} */
    this._setTimeout = opts.setTimeout ?? setTimeout;
    /** @type {(handle: any) => void} */
    this._clearTimeout = opts.clearTimeout ?? clearTimeout;
    this._now = opts.now ?? Date.now;
    this._log = opts.log ?? ((msg) => console.log(`[core-host] ${msg}`));
    /** @type {import('node:child_process').ChildProcess | null} */
    this.child = null;
    /** @type {CoreState} */
    this.state = 'stopped';
    /** @type {number[]} 最近意外退出的时刻 */
    this.crashes = [];
    /** @type {unknown} */
    this.restartTimer = null;
    this.stopping = false;
  }

  /** 启动核心；已经在运行时什么也不做。放弃重启（failed）后再调用会重新开始计数。 */
  start() {
    if (this.child) return;
    this.stopping = false;
    if (this.state === 'failed') this.crashes = [];
    this._spawn();
  }

  /**
   * 给核心发消息；核心没在运行时返回 false。
   * @param {object} message
   */
  send(message) {
    const child = this.child;
    if (!child || !child.connected) return false;
    child.send(message);
    return true;
  }

  /** 停止核心并不再重启；返回时子进程已经退出。 */
  async stop() {
    this.stopping = true;
    if (this.restartTimer) {
      this._clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const child = this.child;
    if (!child) {
      this._setState('stopped');
      return;
    }
    await new Promise((resolve) => {
      const kill = this._setTimeout(() => {
        this._log('核心 5 秒内没有退出，强制结束');
        child.kill('SIGKILL');
      }, STOP_TIMEOUT_MS);
      child.once('exit', () => {
        this._clearTimeout(kill);
        resolve(undefined);
      });
      child.kill('SIGTERM');
    });
  }

  _spawn() {
    this._setState(this.crashes.length ? 'restarting' : 'starting');
    const { entry, cwd, execPath, env } = this.opts;
    const child = this._fork(entry, [], {
      cwd,
      execPath,
      execArgv: ['--import', 'tsx'],
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    this.child = child;
    child.on('message', (message) => {
      if (message && typeof message === 'object' && /** @type {any} */ (message).type === 'ready') this._setState('running');
      this.emit('message', message);
    });
    child.on('exit', (code, signal) => this._onExit(child, code, signal));
    child.on('error', (err) => this._log(`核心进程出错：${err.message}`));
  }

  /**
   * @param {import('node:child_process').ChildProcess} child
   * @param {number | null} code
   * @param {NodeJS.Signals | null} signal
   */
  _onExit(child, code, signal) {
    if (this.child !== child) return;
    this.child = null;
    if (this.stopping) {
      this._log(`核心已退出（${signal ?? code}）`);
      this._setState('stopped');
      return;
    }
    const now = this._now();
    this.crashes = [...this.crashes.filter((t) => now - t < CRASH_WINDOW_MS), now];
    if (this.crashes.length > MAX_CRASHES) {
      this._log(`核心 5 分钟内意外退出 ${this.crashes.length} 次，不再重启（最后一次：${signal ?? code}）`);
      this._setState('failed');
      return;
    }
    this._log(`核心意外退出（${signal ?? code}），${RESTART_DELAY_MS / 1000} 秒后重启`);
    this._setState('restarting');
    this.restartTimer = this._setTimeout(() => {
      this.restartTimer = null;
      if (!this.stopping) this._spawn();
    }, RESTART_DELAY_MS);
  }

  /** @param {CoreState} state */
  _setState(state) {
    if (state === this.state) return;
    this.state = state;
    this.emit('state', state);
  }
}

module.exports = { CoreHost, RESTART_DELAY_MS, CRASH_WINDOW_MS, MAX_CRASHES, STOP_TIMEOUT_MS };
