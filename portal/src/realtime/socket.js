import { io } from 'socket.io-client';
import { getAccessToken, API_BASE } from '../api/client';

let socket = null;
let pingTimer = null;

/** Lazily creates (or reuses) a single authenticated socket connection for the whole app. */
export function getSocket() {
  if (socket) return socket;
  const serverUrl = API_BASE.replace(/\/api\/?$/, '');
  socket = io(serverUrl, { auth: (cb) => cb({ token: getAccessToken() }), autoConnect: true, reconnectionDelayMax: 10000 });
  // Presence heartbeat: lets the other side show "online" / "last seen".
  const ping = () => { if (socket?.connected) socket.emit('presence_ping'); };
  socket.on('connect', ping);
  clearInterval(pingTimer);
  pingTimer = setInterval(ping, 25000);
  return socket;
}

export function disconnectSocket() {
  clearInterval(pingTimer);
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
