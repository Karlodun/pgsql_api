# Техническая спецификация: BTRFS‑менеджер (PHP + локальный доступ)

Документ описывает стартовую реализацию (не MVP), включая структуру UI‑табов, API, конфигурации, sudo‑политику и заготовки под BTRFS Zenbox.

## 1. Структура UI (табы)

1. **Обзор**
   - Карта пулов/дисков/уровней (SSD/HDD), состояние RAID, свободное место.
   - Быстрые индикаторы: ошибки, деградации, активные задачи.

2. **Операции**
   - Добавить/удалить диск.
   - Замена диска (мастер с проверками).
   - Миграции между пулами.
   - Балансировка/scrub (ручной запуск + прогресс).

3. **Снапшоты**
   - Список снапшотов по пулам/томам.
   - Статус расписания и последнего запуска.
   - Ретенция (сколько хранить) и дифф‑оценка.

4. **Настройки**
   - Профили машин (на каждом хосте свои правила).
   - Политики снапшотов (cron‑расписание, ретенция, исключения).
   - Безопасность: локальный доступ/SSH‑туннель, токены/сессии.

5. **BTRFS Zenbox**
   - Управление тестовыми инстансами из снапшотов (PostgreSQL/MySQL/сервисы).
   - Создать → смонтировать → поднять сервис → удалить.

## 2. API (локальный PHP backend)

### 2.1. Общие принципы
- JSON‑ответы: `{ ok: boolean, data, error }`.
- Все операции — идемпотентны по `operation_id`.
- Длинные операции — через очередь задач и polling статуса.

### 2.2. Эндпоинты (черновик)

- `GET /api/hosts`
- `GET /api/pools`
- `GET /api/pools/:id`
- `GET /api/devices`
- `GET /api/snapshots`
- `POST /api/snapshots/run` (ручной запуск политики)
- `POST /api/operations` (добавить/удалить/заменить диск, баланс, scrub)
- `GET /api/operations/:id`

### 2.3. BTRFS Zenbox
- `GET /api/zenbox/instances`
- `POST /api/zenbox/instances` (создать из снапшота)
- `POST /api/zenbox/instances/:id/start`
- `POST /api/zenbox/instances/:id/stop`
- `DELETE /api/zenbox/instances/:id`

## 3. Конфигурации

### 3.1. Профиль хоста (пример)
```yaml
host_id: server-01
btrfs:
  pools:
    - name: data_pool
      mount_point: /data
snapshots:
  schedules:
    - name: hourly
      cron: "0 * * * *"
      retention:
        keep_hours: 24
        keep_days: 7
```

### 3.2. Политика Zenbox
```yaml
zenbox:
  root_dir: /var/zenbox
  instances:
    max_per_host: 10
  services:
    - name: postgres
      data_dir: /var/lib/postgresql/15/main
      ports:
        base: 5433
```

## 4. Sudo и безопасность

- `sudoers` whitelist для команд:
  - `btrfs`, `mount`, `umount`, `lsblk`, `blkid`.
- Выполнение только из локального PHP‑процесса.
- Пароль вводится один раз на сессию и живёт в sudo‑кэше ~10 минут.

## 5. Журналирование и события

- Лог каждой операции: время, команда, параметры, статус, stdout/stderr.
- Audit log хранится локально и показывается в UI.

---

Следующий шаг: согласовать список команд, точные схемы конфигов и макеты табов (layout + индикаторы).
