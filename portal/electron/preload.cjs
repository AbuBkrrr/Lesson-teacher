const { contextBridge } = require('electron');

// The portal's web code doesn't currently need any native capability
// beyond what a browser already provides (it's a REST API client).
// This exists so the renderer can detect "I'm running in the desktop
// app" if that's ever useful (e.g. to hide a "download the app"
// banner), without giving it access to Node or Electron internals.
contextBridge.exposeInMainWorld('lessonTeacherDesktop', {
  isDesktopApp: true,
  platform: process.platform,
});
