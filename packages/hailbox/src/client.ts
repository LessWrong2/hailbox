// Headless client for the Hailbox API, for building your own UI instead of using <Hailbox />.
export { HailboxApi, HailboxApiError, normalizeApiUrl, socketUrl } from './api';
export { CLOSE_UNAUTHORIZED, ReconnectingSocket, type ReconnectingSocketOptions } from './socket';
