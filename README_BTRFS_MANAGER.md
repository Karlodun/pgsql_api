# BTRFS Manager (PHP)

Локальный web‑интерфейс для контроля пулов BTRFS, снапшотов и BTRFS Zenbox.

## Быстрый старт

1. Разместите папку `btrfs_manager` в корне веб‑сервера.
2. Убедитесь, что PHP запускается через `php-fpm`.
3. Откройте `btrfs_manager/public/index.php` в браузере.

## Структура

- `btrfs_manager/public` — UI и API endpoints (`api.php`).
- `btrfs_manager/lib` — утилиты для конфигурации и команд.
- `btrfs_manager/config/manager.json` — основная конфигурация.
- `btrfs_manager/data/sample_state.json` — пример данных для UI.

## Sudo и безопасность

- Настройте `sudoers` для ограниченного списка команд (`btrfs`, `mount`, `umount`, `lsblk`, `blkid`).
- Доступ предполагается только локально (localhost/локальная сеть/SSH‑туннель).

## Следующий шаг

После согласования списка команд и схемы конфигов добавим:
- реальные драйверы для чтения `btrfs` состояния,
- очередь задач для долгих операций,
- управление снапшотами и BTRFS Zenbox.
