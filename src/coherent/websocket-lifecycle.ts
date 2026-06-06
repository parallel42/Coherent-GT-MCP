import WebSocket from "ws";

export function closeWebSocketSafely(socket: WebSocket | undefined): void {
  if (!socket) {
    return;
  }

  socket.removeAllListeners();
  socket.on("error", () => undefined);
  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
    socket.close();
  }
}
