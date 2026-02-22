// SSE connection helper with auto-reconnect

export function createSseConnection(
  url: string,
  eventName: string,
  onData: (data: unknown) => void
): () => void {
  let es: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  function connect() {
    if (closed) return;
    es = new EventSource(url);

    es.addEventListener(eventName, (e: MessageEvent) => {
      try { onData(JSON.parse(e.data)); } catch { /* ignore parse errors */ }
    });

    es.onerror = () => {
      es?.close();
      es = null;
      if (!closed) {
        reconnectTimer = setTimeout(connect, 3000);
      }
    };
  }

  connect();

  return () => {
    closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    es?.close();
  };
}
