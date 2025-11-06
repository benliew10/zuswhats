#!/bin/bash

echo "🧹 Cleaning up..."

# Kill all node processes running index.js
pkill -9 -f "node index.js" 2>/dev/null

# Kill any Chrome processes related to whatsapp
pkill -f "Chrome.*wwebjs" 2>/dev/null

# Kill processes on port 3000
lsof -ti:3000 | xargs kill -9 2>/dev/null

# Remove the singleton lock file
rm -f /Users/Apple/Desktop/zus/.wwebjs_auth/session/SingletonLock

echo "✅ Cleanup complete"
echo ""
echo "🚀 Starting bot..."
sleep 2

# Start the bot
npm start
