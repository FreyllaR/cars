#!/bin/sh
# Builds the page and copies the game and its server to the VPS.
# Caddy serves the page from /var/www/cars and proxies /api and /ws to the server on 127.0.0.1:4100.
set -e
HOST=root@149.33.31.119
python3 build.py
scp -q index.html vendor/three.min.js vendor/fonts.css "$HOST:/var/www/cars/"
scp -q -r vendor/fonts vendor/models "$HOST:/var/www/cars/"
scp server/server.js "$HOST:/opt/turbo-krug/server.js"
ssh "$HOST" 'systemctl restart turbo-krug && systemctl is-active turbo-krug'
echo "Готово: https://cars.149-33-31-119.sslip.io"
