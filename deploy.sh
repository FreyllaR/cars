#!/bin/sh
# Копирует игру на сервер. Caddy раздаёт её по адресу https://cars.149-33-31-119.sslip.io
set -e
scp index.html root@149.33.31.119:/var/www/cars/index.html
echo "Готово: https://cars.149-33-31-119.sslip.io"
