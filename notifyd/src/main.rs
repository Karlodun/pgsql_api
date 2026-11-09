//! notifyd — the "pusher" for pgsql_api.
//!
//! One process, one PostgreSQL connection (LISTEN notify_event), any number of clients.
//! Clients poll `/events?cursor=` every ~30 s (truth) and may keep `/stream` open
//! for instant hints. They never connect to the database; they re-read changed
//! data through pgsql_api with their own role, so RLS/CLS stay in charge.

mod db;
mod feed;
mod http;
mod token;
mod webhooks;

use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use tokio::sync::{broadcast, mpsc};
use tokio::time::MissedTickBehavior;
use tokio_postgres::Client;

use feed::{Batch, Event, Feed};
use webhooks::Hooks;

/// Rows fetched from notify.event per query when the feed advances.
const PAGE: usize = 5000;

pub struct Config {
    pub database_url: String,
    pub listen: SocketAddr,
    pub secret: String,
    pub aud: String,
    pub buffer: usize,
    pub retention_secs: u64,
    pub purge_every_secs: u64,
    pub tick_ms: u64,
    pub cors_origins: Vec<String>,
    pub webhooks_file: Option<String>,
}

fn var(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

fn num<T: std::str::FromStr>(name: &str, default: T) -> Result<T, String> {
    match var(name) {
        None => Ok(default),
        Some(v) => v.parse().map_err(|_| format!("{name}: not a number: {v}")),
    }
}

impl Config {
    fn from_env() -> Result<Self, String> {
        let need = |n: &str| var(n).ok_or_else(|| format!("{n} is required"));
        Ok(Config {
            database_url: need("NOTIFYD_DATABASE_URL")?,
            secret: need("NOTIFYD_SECRET")?,
            aud: need("NOTIFYD_AUD")?,
            listen: var("NOTIFYD_LISTEN")
                .unwrap_or_else(|| "127.0.0.1:8090".into())
                .parse()
                .map_err(|_| "NOTIFYD_LISTEN: expected host:port".to_string())?,
            buffer: num("NOTIFYD_BUFFER", 50_000)?,
            retention_secs: num("NOTIFYD_RETENTION_SECS", 86_400)?,
            purge_every_secs: num("NOTIFYD_PURGE_EVERY_SECS", 600)?,
            tick_ms: num("NOTIFYD_TICK_MS", 1000)?,
            cors_origins: var("NOTIFYD_CORS_ORIGINS")
                .map(|v| {
                    v.split(',')
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect()
                })
                .unwrap_or_default(),
            webhooks_file: var("NOTIFYD_WEBHOOKS"),
        })
    }
}

pub struct App {
    pub cfg: Config,
    pub feed: RwLock<Feed>,
    pub db: tokio::sync::RwLock<Option<Arc<Client>>>,
    pub purged_below: AtomicU64,
    pub tx: broadcast::Sender<Arc<Batch>>,
    pub ready: AtomicBool,
}

#[tokio::main]
async fn main() {
    let cfg = Config::from_env().unwrap_or_else(|e| {
        eprintln!("notifyd: config: {e}");
        std::process::exit(2);
    });
    let hooks = Hooks::load(cfg.webhooks_file.as_deref()).unwrap_or_else(|e| {
        eprintln!("notifyd: webhooks: {e}");
        std::process::exit(2);
    });

    let (tx, _) = broadcast::channel(1024);
    let listen = cfg.listen;
    let buffer = cfg.buffer;
    let app = Arc::new(App {
        cfg,
        feed: RwLock::new(Feed::new(0, buffer)),
        db: tokio::sync::RwLock::new(None),
        purged_below: AtomicU64::new(0),
        tx,
        ready: AtomicBool::new(false),
    });

    eprintln!("notifyd: {} webhook(s) configured", hooks.len());
    tokio::spawn(supervise(app.clone(), hooks));

    let listener = tokio::net::TcpListener::bind(listen)
        .await
        .unwrap_or_else(|e| {
            eprintln!("notifyd: cannot listen on {listen}: {e}");
            std::process::exit(1);
        });
    eprintln!("notifyd: listening on {listen}");
    if let Err(e) = axum::serve(listener, http::router(app)).await {
        eprintln!("notifyd: server error: {e}");
        std::process::exit(1);
    }
}

/// Keep the database connection alive; reconnect forever.
async fn supervise(app: Arc<App>, hooks: Hooks) {
    loop {
        match db::connect(&app.cfg.database_url).await {
            Ok((client, mut notes, conn_task)) => {
                eprintln!("notifyd: connected, LISTEN {}", db::CHANNEL);
                *app.db.write().await = Some(client.clone());
                if let Err(e) = run(&app, &hooks, &client, &mut notes).await {
                    eprintln!("notifyd: feed interrupted: {e}");
                }
                *app.db.write().await = None;
                conn_task.abort();
            }
            Err(e) => eprintln!("notifyd: cannot connect to database: {e}"),
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}

fn feed_horizon(app: &App) -> u64 {
    app.feed.read().expect("feed lock").horizon()
}

fn reset_feed(app: &App, horizon: u64) {
    *app.feed.write().expect("feed lock") = Feed::new(horizon, app.cfg.buffer);
}

fn push_feed(app: &App, horizon: u64, events: Vec<Arc<Event>>) {
    app.feed.write().expect("feed lock").push(horizon, events);
}

async fn run(
    app: &App,
    hooks: &Hooks,
    db: &Client,
    notes: &mut mpsc::UnboundedReceiver<()>,
) -> Result<(), db::Error> {
    app.purged_below
        .store(db::purged_below(db).await?, Ordering::Release);
    if !app.ready.load(Ordering::Acquire) {
        // First start: begin at "now". Older history is served from notify.event on demand.
        reset_feed(app, db::horizon(db).await?);
        app.ready.store(true, Ordering::Release);
    }

    let mut tick = tokio::time::interval(Duration::from_millis(app.cfg.tick_ms.max(50)));
    tick.set_missed_tick_behavior(MissedTickBehavior::Delay);
    let mut purge = tokio::time::interval(Duration::from_secs(app.cfg.purge_every_secs.max(10)));
    purge.set_missed_tick_behavior(MissedTickBehavior::Delay);

    loop {
        tokio::select! {
            n = notes.recv() => {
                if n.is_none() {
                    return Err("LISTEN connection closed".into());
                }
                while notes.try_recv().is_ok() {} // many NOTIFYs, one look
            }
            // Also look periodically: the horizon can move without any NOTIFY
            // (a long transaction without events finished and released held-back events).
            _ = tick.tick() => {}
            _ = purge.tick() => {
                let (deleted, below) = db::purge(db, app.cfg.retention_secs).await?;
                app.purged_below.store(below, Ordering::Release);
                if deleted > 0 {
                    eprintln!("notifyd: retention removed {deleted} event(s)");
                }
            }
        }
        advance(app, hooks, db).await?;
    }
}

/// Move the feed forward to the current database horizon, page by page.
async fn advance(app: &App, hooks: &Hooks, db: &Client) -> Result<(), db::Error> {
    let target = db::horizon(db).await?;
    let mut from = feed_horizon(app);

    if target < from {
        // Database went back in time (restore from backup?). Everybody must resync.
        eprintln!(
            "notifyd: database horizon {target} is below feed horizon {from}; resetting feed"
        );
        reset_feed(app, target);
        return Ok(());
    }

    while from < target {
        let (rows, next) = db::page(db, from, target, PAGE).await?;
        let events: Vec<Arc<Event>> = rows.into_iter().map(Arc::new).collect();
        let batch = Arc::new(Batch {
            horizon: next,
            events: events.clone(),
        });
        push_feed(app, next, events);
        if !batch.events.is_empty() {
            let _ = app.tx.send(batch.clone()); // Err only means "no SSE subscribers"
            hooks.dispatch(&batch);
        }
        from = next;
    }
    Ok(())
}
