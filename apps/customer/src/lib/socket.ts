import { io, type Socket } from 'socket.io-client';

import { apiBaseUrl } from './api';

/**
 * Opens a live connection for one order and joins its room.
 *
 * The caller owns the socket: attach listeners to the returned instance and
 * call `.disconnect()` when the screen unmounts. See apps/backend/src/lib/socket.ts
 * for the full event contract.
 *
 *   server -> client   order:status    { orderId, status, updatedAt }
 *                      rider:location  { lat, lng, updatedAt }
 *                      order:joined    { orderId }
 *                      error           { event, message }
 */
export function connectOrderSocket(orderId: string, token: string): Socket {
  const socket = io(apiBaseUrl, {
    // The backend's io.use() handshake reads socket.handshake.auth.token and
    // runs it through the same verifyFirebaseToken the HTTP routes use.
    auth: { token },
    transports: ['websocket'],
  });

  // Fires on the first connection AND on every reconnect, so a dropped
  // connection rejoins the room by itself rather than going quietly deaf.
  socket.on('connect', () => {
    // The backend handler is `socket.on('order:join', (orderId: unknown) => ...)`
    // and rejects anything that is not a string, so this sends the bare id —
    // an { orderId } object would come back as "orderId is required".
    socket.emit('order:join', orderId);
  });

  return socket;
}
