const SocketManager = (() => {
  let socket = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT = 10;

  function connect(token) {
    if (socket) socket.disconnect();

    socket = io(window.location.origin, {
      auth: { token },
      reconnectionAttempts: MAX_RECONNECT,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socket.on('connect', () => {
      reconnectAttempts = 0;
      updateStatus(true);
    });

    socket.on('disconnect', () => updateStatus(false));

    socket.on('connect_error', () => {
      reconnectAttempts++;
      updateStatus(false, reconnectAttempts >= MAX_RECONNECT ? 'Disconnected' : `Reconnecting…`);
    });

    return socket;
  }

  // Registers directly on the live socket — connect() must run first (both callers already do this)
  function on(event, handler) {
    if (socket) socket.on(event, handler);
  }

  function disconnect() {
    if (socket) { socket.disconnect(); socket = null; }
  }

  // Bug fix: use correct IDs from new HTML (#sDot, #sText)
  function updateStatus(connected, text) {
    const dot = document.getElementById('sDot');
    const label = document.getElementById('sText');
    if (dot) {
      dot.className = 's-dot' + (connected ? ' live' : ' dead');
    }
    if (label) {
      label.textContent = connected ? 'Live' : (text || 'Disconnected');
    }
  }

  return { connect, on, disconnect };
})();
