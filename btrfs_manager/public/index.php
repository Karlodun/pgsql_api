<?php

declare(strict_types=1);

?><!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>BTRFS Manager</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <div class="app">
    <header class="app__header">
      <div>
        <h1>BTRFS Manager</h1>
        <p class="muted">Локальный контроль пулов, снапшотов и BTRFS Zenbox.</p>
      </div>
      <div class="status" id="status">Загрузка...</div>
    </header>

    <nav class="tabs" role="tablist">
      <button class="tab active" data-tab="overview">Обзор</button>
      <button class="tab" data-tab="operations">Операции</button>
      <button class="tab" data-tab="snapshots">Снапшоты</button>
      <button class="tab" data-tab="settings">Настройки</button>
      <button class="tab" data-tab="zenbox">BTRFS Zenbox</button>
    </nav>

    <section class="tab-content active" id="tab-overview">
      <div class="grid">
        <div class="card">
          <h2>Пулы</h2>
          <ul id="pools"></ul>
        </div>
        <div class="card">
          <h2>Устройства</h2>
          <ul id="devices"></ul>
        </div>
      </div>
    </section>

    <section class="tab-content" id="tab-operations">
      <div class="card">
        <h2>Операции</h2>
        <p class="muted">Здесь будут запускаться операции добавления/удаления/баланса.</p>
        <pre id="operations"></pre>
      </div>
    </section>

    <section class="tab-content" id="tab-snapshots">
      <div class="card">
        <h2>Политики снапшотов</h2>
        <pre id="snapshot-policies"></pre>
      </div>
      <div class="card">
        <h2>Снапшоты</h2>
        <ul id="snapshots"></ul>
      </div>
    </section>

    <section class="tab-content" id="tab-settings">
      <div class="card">
        <h2>Настройки</h2>
        <pre id="settings"></pre>
      </div>
    </section>

    <section class="tab-content" id="tab-zenbox">
      <div class="card">
        <h2>BTRFS Zenbox</h2>
        <p class="muted">Создание тестовых инстансов из снапшотов.</p>
        <pre id="zenbox"></pre>
      </div>
    </section>
  </div>

  <script src="app.js"></script>
</body>
</html>
