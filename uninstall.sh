#!/bin/bash

# Удаление Pryanik Cloud

# Проверить root
if [ "$EUID" -ne 0 ]; then
  echo "Запусти с sudo: sudo bash uninstall.sh"
  exit 1
fi

echo "Удаление Pryanik Cloud..."

# Остановить и удалить сервис
systemctl stop pryanik-cloud.service 2>/dev/null
systemctl disable pryanik-cloud.service 2>/dev/null
rm -f /etc/systemd/system/pryanik-cloud.service
systemctl daemon-reload

# Удалить CLI утилиту
rm -f /usr/local/bin/pryanikc

# Удалить директорию (если она в ~)
DIR="$HOME/pryanik-cloud"
if [ -d "$DIR" ]; then
  rm -rf "$DIR"
fi

echo "Удаление завершено!"
