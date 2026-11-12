// @ts-check
/**
 * 设置页的 preload：只把下面这几个方法交给网页（window.coopet），网页本身拿不到 Node 和 Electron 的能力。
 * 所有调用都走 IPC 到外壳主进程，由主进程检查后转给核心或自己处理。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('coopet', {
  /** 配置请求（转给核心）：settings.get / settings.save / settings.saveToken / settings.testConnection */
  request: (/** @type {string} */ method, /** @type {unknown} */ params) => ipcRenderer.invoke('coopet:request', method, params),
  /** 外壳自己的操作：openDress / openLogs / restartCore / getLoginItem / setLoginItem */
  shell: (/** @type {string} */ action, /** @type {unknown} */ arg) => ipcRenderer.invoke('coopet:shell', action, arg),
  /** 外壳推来的状态（核心、连接）；返回取消订阅的函数 */
  onStatus: (/** @type {(s: unknown) => void} */ cb) => {
    /** @param {unknown} _e @param {unknown} s */
    const handler = (_e, s) => cb(s);
    ipcRenderer.on('coopet:status', handler);
    return () => ipcRenderer.removeListener('coopet:status', handler);
  },
  /** 桌宠的对话流：open 返回 streamId；数据从 onData 来 */
  chat: {
    open: () => ipcRenderer.invoke('coopet:chat-open'),
    send: (/** @type {number} */ streamId, /** @type {string} */ text) => ipcRenderer.send('coopet:chat-send', streamId, text),
    close: (/** @type {number} */ streamId) => ipcRenderer.send('coopet:chat-close', streamId),
    onData: (/** @type {(streamId: number, data: string | null) => void} */ cb) => {
      /** @param {unknown} _e @param {number} id @param {string | null} data */
      const handler = (_e, id, data) => cb(id, data);
      ipcRenderer.on('coopet:chat-data', handler);
      return () => ipcRenderer.removeListener('coopet:chat-data', handler);
    },
  },
});
