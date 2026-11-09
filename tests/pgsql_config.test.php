<?php
// Config used by tests/run-e2e.sh (copied as pgsql_config.php into a temporary docroot).
$pgsql_profiles = [
    'test' => [
        'host'       => '127.0.0.1',
        'port'       => getenv('PGPORT') ?: 5432,
        'dbname'     => getenv('PGDATABASE') ?: 'e2e',
        'name'       => 'E2E',
        'events_url' => 'http://127.0.0.1:' . (getenv('MOCK_PORT') ?: 8091),
        'events_aud' => 'test',
    ],
];
$pgsql_events = ['secret' => getenv('PGSQL_EVENT_SECRET'), 'ttl' => 300];
