<?php
// Configuration file for PostgreSQL connection profiles
// This file defines the available database connection profiles

$pgsql_profiles = [
    'dev_local' => [
        'host' => 'localhost',
        'dbname' => 'dev',
        'port' => 5432,
        'class' => 'dev',
        'description' => 'Localhost development database'
    ],
    'dev_socket' => [
        'dbname' => 'dev',
        'class' => 'dev',
        'description' => 'development database - socket connection'
    ]
];