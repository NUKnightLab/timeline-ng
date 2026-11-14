/**
 * The WebSocket subprotocol that carries a service auth token.
 *
 * In its own module because both the entry point (which reads it) and the
 * room (which must echo it back on the 101) need it, and the entry point
 * already imports the room.
 *
 * A browser's WebSocket constructor cannot set headers, so the token travels
 * as the second subprotocol value rather than a query parameter: a URL reaches
 * logs, referrers and history, and a bearer credential should not. Base64url
 * and `.` are all valid subprotocol characters, so a JWT needs no re-encoding.
 */
export const AUTH_PROTOCOL = 'atproto-service-auth';

/** What the entry point hands the room once a token has checked out. */
export const DID_HEADER = 'X-Authenticated-Did';
export const EXPIRY_HEADER = 'X-Token-Expiry';
