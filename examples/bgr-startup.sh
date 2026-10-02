#!/bin/bash
# bgr-startup.sh - Example startup script for BGR processes
# Place in /usr/local/bin/bgr-startup.sh and make executable

# Wait for network to be ready
sleep 5

# Start database services
echo "Starting database services..."
bgr --name postgres --command "postgres -D /var/lib/postgresql/data"
bgr --name redis --command "redis-server /etc/redis/redis.conf"

# Wait for databases to be ready
sleep 3

# Start web server / reverse proxy
echo "Starting web server..."
bgr --name caddy --directory /etc/caddy --command "caddy run"

# Start application services
echo "Starting application services..."
bgr --name api \
    --directory /var/www/api \
    --command "node dist/server.js" \
    --config production.toml

bgr --name worker \
    --directory /var/www/worker \
    --command "python worker.py" \
    --config production.toml

# Optional: Start monitoring guards
echo "Starting process guards..."
bgr --name api-guard \
    --directory /var/www/api \
    --command "bun /opt/bgr/examples/guard.ts api 30"

# Show final status
echo "All services started. Current status:"
bgr
