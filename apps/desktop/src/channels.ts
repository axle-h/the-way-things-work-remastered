// The IPC channels between the preload bridge (preload.ts) and the main process (main/main.ts), one
// per bridge method (DesktopBridge in apps/web/src/desktop-bridge.ts).
export const Channel = {
  copyPng: 'twtw:copy-png',
  changeDisc: 'twtw:change-disc',
  discStatus: 'twtw:disc-status',
  chooseDisc: 'twtw:choose-disc',
  openApp: 'twtw:open-app',
} as const;
