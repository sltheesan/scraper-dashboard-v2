#!/bin/bash

export DISPLAY=:99

rm -f /tmp/.X99-lock /tmp/.X11-unix/X99

Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &
XVFB_PID=$!
sleep 2

if ! kill -0 $XVFB_PID 2>/dev/null; then
  echo "ERROR: Xvfb failed to start, retrying..."
  Xvfb :99 -screen 0 1920x1080x24 -ac &
  XVFB_PID=$!
  sleep 2
fi

if kill -0 $XVFB_PID 2>/dev/null; then
  echo "Xvfb started on display :99 (pid=$XVFB_PID)"

  x11vnc -display :99 -forever -shared -nopw -rfbport 5900 -listen 127.0.0.1 -q &
  echo "x11vnc started (pid=$!)"

  websockify --web /usr/share/novnc 6080 localhost:5900 > /dev/null 2>&1 &
  echo "noVNC/websockify started on port 6080 (pid=$!)"
else
  echo "WARNING: Xvfb failed to start — login (headed browser) will not work"
fi

echo "Starting NestJS application..."
exec node dist/main.js
