# Lesson Teacher: local-first / peer-to-peer architecture (design proposal)

Status: proposal, not implemented. Needs owner decisions in section 8.

## 1. Goal
Every desktop and Android install runs its own node (local DB + local API on localhost) and talks directly to other users' nodes. The central server is only for subscriptions, support, identity verification and other things that need a trusted party. Chat, calls and lesson data must keep working when the central server is down.

## 2. Reality check
- Phones and home PCs are behind NAT, change IPs and go offline. Pure P2P needs NAT traversal (STUN/ICE) and fallback relays (TURN). Relays can be dumb (carry only encrypted bytes) and community- or self-hosted, but at least a tiny rendezvous service is still needed so peers find each other.
- Android kills background services. A phone cannot be an always-on server. Messages for an offline peer need store-and-forward by a relay or by a peer that is online.
- "No central server" for the whole product is not achievable. "Central server not required for core use" is.

## 3. Node architecture (each install)
- Local node: embedded SQLite (replaces the Postgres adapter via the existing `db.prepare` interface), local HTTP/WebSocket API on 127.0.0.1 used by the UI. The UI code stays the same; only the API base changes.
- Identity: per-user Ed25519 keypair generated on device. The server signs a short-lived "identity certificate" (user id, role, verified flag, expiry) after verification. Peers trust the certificate, not the server's availability.
- Transport: libp2p or WebRTC data channels (ICE with STUN/TURN). Discovery by DHT or a rendezvous list of relay peers; direct LAN discovery via mDNS.
- Sync: per-conversation append-only log, CRDT or signed op-log. Reuses the existing `client_id` idempotency and `?after=` delta model. Conflicts resolve by (lamport time, author id).
- Calls: WebRTC mesh for 1:1 (replaces mediasoup SFU for the common case). The SFU stays optional for groups.
- Offline: relay peers hold encrypted envelopes for up to N days (store-and-forward).

## 4. What stays on the central server
Subscriptions and payments, ID verification and badges, support tickets, admin console, certificate issuing/revocation list, push notification wake-ups, optional discovery directory for tutors, abuse reports.

## 5. Features that change
| Feature | Central today | P2P design |
|---|---|---|
| Tutor discovery / swipe | server query | tutors publish signed profile cards to the directory or DHT; the server directory remains the fast path |
| Chat | server stores everything | peer log + relay store-and-forward |
| Bookings | server row | two-party signed agreement; the server only records payment |
| Material / files | server uploads | content-addressed blobs sent peer to peer (or via relay) |
| Parent monitoring of child chats | server visibility | see section 6 |
| Safety flagging | server scans text | see section 6 |
| Revoking a banned user | instant | certificate expiry + revocation list; delay up to cert TTL |
| Audit log | server | local logs; no global audit |

## 6. Child-safety conflict (main decision)
Today parents are read-only participants in child-tutor chats, edits and deletes retain originals for monitors, and the server flags content. Without a central party:
- Option A (recommended): parent device is a cryptographic participant. Child-tutor conversations are encrypted to tutor + child + all linked parent devices, so monitoring survives. Flagging runs on the parent/child device and reports to the server only when triggered.
- Option B: keep child-tutor chat server-mediated; use P2P only for adult-to-adult and non-child data.
- Option C: full P2P everywhere. Not recommended: no moderation, no reliable parental oversight.

## 7. Phased plan
1. Local node shell: SQLite adapter, localhost API inside Electron and Expo (react-native nodejs mobile or a JS core), app works against its own DB.
2. Identity certificates and device keys, signed messages.
3. Relay and rendezvous service (small, stateless) plus WebRTC data channels; direct chat with offline relay.
4. Chat log sync (CRDT), attachments as content-addressed blobs.
5. 1:1 calls over WebRTC; keep SFU for groups.
6. Child-safety Option A (multi-recipient encryption, on-device flagging).
7. Server shrinks to the section 4 list; the migration path moves existing data to local nodes.

Rough effort: several weeks per phase for one developer; phases 3 and 6 are the hard ones.

## 8. Decisions needed from the owner
1. Child-safety option A, B or C (section 6).
2. Acceptable to run a small relay/rendezvous service (yes is needed for reliability on phones).
3. Is end-to-end encryption now allowed (required for Option A)?
4. Keep the server tutor directory for discovery, or fully decentralised discovery?
5. Mobile: embed a Node core (react-native nodejs mobile) or reimplement the core in JS inside the app?
