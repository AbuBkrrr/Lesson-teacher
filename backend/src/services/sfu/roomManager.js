const { getNextWorker, MEDIA_CODECS } = require('./workerPool');

const LISTEN_IP = process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0';
// In production this MUST be the server's actual public IP (or a TURN-friendly
// reachable address) — browsers connect their ICE candidates to this address,
// not to LISTEN_IP. 127.0.0.1 only works when the client and server share a
// host, which is fine for local dev/testing but not a real deployment.
const ANNOUNCED_IP = process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1';

const TRANSPORT_OPTIONS = {
  listenIps: [{ ip: LISTEN_IP, announcedIp: ANNOUNCED_IP }],
  enableUdp: true,
  enableTcp: true,
  preferUdp: true,
};

/** roomId (booking id) -> Room */
const rooms = new Map();

/**
 * A Room wraps one mediasoup Router (the SFU's per-call media pipeline)
 * plus the peers currently connected to it. One room per booking — a
 * lesson's video call — so state naturally lines up with the domain
 * model already used for chat/payments.
 */
class Room {
  constructor(id, router) {
    this.id = id;
    this.router = router;
    this.peers = new Map(); // userId -> Peer
    this.whiteboard = []; // strokes; loaded from / saved to lesson_whiteboards by lessonSignaling
    this.whiteboardLoaded = false;
    this.whiteboardDirty = false;
    this.onClose = null; // async hook run before the router closes (used to persist the whiteboard)
  }

  isEmpty() {
    return this.peers.size === 0;
  }

  async close() {
    if (this.onClose) {
      try { await this.onClose(this); } catch (err) { console.error('[sfu] room close hook failed', err); }
    }
    for (const peer of this.peers.values()) peer.close();
    this.peers.clear();
    this.router.close(); // closing the router also closes every transport/producer/consumer it owns
    rooms.delete(this.id);
  }
}

/** One connected participant: their transports, and what they're sending/receiving. */
class Peer {
  constructor(userId, socketId, role) {
    this.userId = userId;
    this.socketId = socketId;
    this.role = role; // 'tutor' | 'parent' | 'student' — for labeling remote video tiles client-side
    this.transports = new Map(); // transportId -> WebRtcTransport
    this.producers = new Map(); // producerId -> Producer
    this.consumers = new Map(); // consumerId -> Consumer
  }

  close() {
    for (const t of this.transports.values()) t.close(); // cascades to this peer's producers/consumers
    this.transports.clear();
    this.producers.clear();
    this.consumers.clear();
  }
}

async function getOrCreateRoom(roomId) {
  let room = rooms.get(roomId);
  if (room) return room;

  const worker = getNextWorker();
  const router = await worker.createRouter({ mediaCodecs: MEDIA_CODECS });
  room = new Room(roomId, router);
  rooms.set(roomId, room);
  return room;
}

function getRoom(roomId) {
  return rooms.get(roomId);
}

async function createWebRtcTransport(router) {
  const transport = await router.createWebRtcTransport({
    ...TRANSPORT_OPTIONS,
    initialAvailableOutgoingBitrate: 800000,
  });
  return transport;
}

module.exports = { Room, Peer, getOrCreateRoom, getRoom, createWebRtcTransport, rooms };
