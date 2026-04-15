#!/bin/bash
cd /tmp/ortoo
node server.js > /tmp/ortoo/server.log 2>&1 &
SERVER_PID=$!
sleep 3
echo "Server PID: $SERVER_PID"
cat /tmp/ortoo/server.log
echo "---"
node test.js 2>&1
kill $SERVER_PID 2>/dev/null
