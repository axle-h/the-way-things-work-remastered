// The preload script: the only bridge between the pages and the main process. It runs sandboxed,
// with context isolation, and exposes exactly the DesktopBridge methods, each one IPC message that
// the main process checks. The pages never get ipcRenderer, Node or Electron themselves.
import { contextBridge, ipcRenderer } from 'electron';
import { DESKTOP_BRIDGE_NAME, type DesktopBridge, type DiscKind } from '@twtw/web/desktop-bridge';
import { Channel } from './channels.ts';

const bridge: DesktopBridge = {
  platform: process.platform,
  copyPng: (png: Uint8Array) => ipcRenderer.invoke(Channel.copyPng, png),
  changeDisc: () => ipcRenderer.invoke(Channel.changeDisc),
  discStatus: () => ipcRenderer.invoke(Channel.discStatus),
  chooseDisc: (kind: DiscKind) => ipcRenderer.invoke(Channel.chooseDisc, kind),
  openApp: () => ipcRenderer.invoke(Channel.openApp),
};

contextBridge.exposeInMainWorld(DESKTOP_BRIDGE_NAME, bridge);
