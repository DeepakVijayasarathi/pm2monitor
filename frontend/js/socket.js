const SocketManager = (() => {
  let socket = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT = 10;
  const handlers = {};

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

    socket.on('disconnect', () => {
      updateStatus(false);
    });

    socket.on('connect_error', (err) => {
      reconnectAttempts++;
      updateStatus(false, `Connection error (${reconnectAttempts}/${MAX_RECONNECT})`);
      if (reconnectAttempts >= MAX_RECONNECT) {
        updateStatus(false, 'Disconnected');
      }
    });

    socket.on('metrics', (data) => {
      if (handlers.metrics) handlers.metrics(data);
    });

    return socket;
  }

  function on(event, handler) {
    handlers[event] = handler;
    if (socket) socket.on(event, handler);
  }

  function subscribeLogs(appId) {
    if (socket) socket.emit('subscribe:logs', appId);
  }

  function unsubscribeLogs(appId) {
    if (socket) socket.emit('unsubscribe:logs', appId);
  }

  function disconnect() {
    if (socket) { socket.disconnect(); socket = null; }
  }

  function updateStatus(connected, text) {
    const dot = document.getElementById('connectionStatus')?.querySelector('.status-dot');
    const statusText = document.getElementById('connectionStatus')?.querySelector('.status-text');
    if (dot) {
      dot.classList.toggle('connected', connected);
      dot.classList.toggle('disconnected', !connected);
    }
    if (statusText) {
      statusText.textContent = connected ? 'Live' : (text || 'Disconnected');
    }
  }

  return { connect, on, subscribeLogs, unsubscribeLogs, disconnect };
})();
