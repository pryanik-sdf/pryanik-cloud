#!/bin/bash

# Установка Pryanik Cloud

echo "Установка Pryanik Cloud..."

# Проверить root
if [ "$EUID" -ne 0 ]; then
  echo "Запусти с sudo: sudo bash install.sh"
  exit 1
fi

# Проверить Node.js
if ! command -v node &> /dev/null; then
  echo "Node.js не найден. Устанавливаю..."
  apt update && apt install nodejs npm -y
fi

# Проверить зависимости
cd "$(dirname "$0")" || exit 1
npm install

# Настройка .env
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Настройте .env файл!"
  read -p "IP сервера (например, 192.168.100.8): " HOST
  read -p "Порт (3000): " PORT
  PORT=${PORT:-3000}
  JWT_SECRET=$(openssl rand -base64 32)
  sed -i "s/HOST=.*/HOST=$HOST/" .env
  sed -i "s/PORT=.*/PORT=$PORT/" .env
  sed -i "s/JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" .env
  echo "JWT_SECRET установлен автоматически"
fi

# Копировать systemd сервис
echo "Установка автозагрузки..."
SERVICE_FILE="/etc/systemd/system/pryanik-cloud.service"
cat > "$SERVICE_FILE" << EOF
[Unit]
Description=Pryanik Cloud Storage Server
After=network.target

[Service]
Type=simple
User=$SUDO_USER
WorkingDirectory=$(pwd)
ExecStart=$(pwd)/node_modules/.bin/node $(pwd)/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable pryanik-cloud
systemctl start pryanik-cloud

# Копировать CLI утилиту
cp bin/pryanikc /usr/local/bin/pryanikc
chmod +x /usr/local/bin/pryanikc

echo "Установка завершена!"
echo "Сервер работает на $HOST:$PORT"
echo "Команда: sudo systemctl status pryanik-cloud"
echo "CLI: pryanikc -help"
