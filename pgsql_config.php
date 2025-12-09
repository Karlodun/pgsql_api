<?php
// Configuration file for PostgreSQL connection profiles
// This file defines the available database connection profiles

$pgsql_profiles = [
    'dev_local' => [
        'host' => 'localhost',
        'dbname' => 'testdb',
        'port' => 5432,
        'description' => 'Local development database'
    ],
    'test_server' => [
        'host' => 'test.example.com',
        'dbname' => 'testdb',
        'port' => 5432,
        'description' => 'Testing environment database'
    ],
    'prod_main' => [
        'host' => 'prod.example.com',
        'dbname' => 'proddb',
        'port' => 5432,
        'description' => 'Main production database'
    ],
    'client_42_db' => [
        'host' => 'client42.example.com',
        'dbname' => 'client42db',
        'port' => 5432,
        'description' => 'Client 42 database'
    ]
];

$pgsql_profile_info = [
    'dev_local' => [
        'name' => 'Local Development',
        'class' => 'Dev',
        'description' => 'Local development database'
    ],
    'test_server' => [
        'name' => 'Test Server',
        'class' => 'Test',
        'description' => 'Testing environment database'
    ],
    'prod_main' => [
        'name' => 'Production Main',
        'class' => 'Prod',
        'description' => 'Main production database'
    ],
    'client_42_db' => [
        'name' => 'Client 42 Database',
        'class' => 'Client-42',
        'description' => 'Database for Client 42'
    ]
];