//! HTTP interface.
//!
//! GET /events?cursor=C   — poll: what happened since C (the source of truth)
//! GET /stream            — SSE: "hint" events with the newest cursor (only a nudge to poll now)
//! GET /health            — liveness / basic stats
//!
//! Token: `Authorization: Bearer <token>` or `?token=<token>` (EventSource cannot set headers).

use std::collections::HashMap;
use std::convert::Infallible;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Query, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::sse::{Event as SseEvent, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use tokio::sync::{broadcast, mpsc};
use tokio_stream::wrappers::ReceiverStream;
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::feed::{response_json, Access, Event, Read};
use crate::token::{self, Claims};
use crate::{db, App};

type Params = Query<HashMap<String, String>>;

pub fn router(app: Arc<App>) -> Router {
    let origins: Vec<HeaderValue> = app
        .cfg
        .cors_origins
        .iter()
        .filter_map(|o| HeaderValue::from_str(o).ok())
        .collect();

    let router = Router::new()
        .route("/events", get(events))
        .route("/stream", get(stream))
        .route("/health", get(health))
        .with_state(app);

    if origins.is_empty() {
        router
    } else {
        router.layer(
            CorsLayer::new()
                .allow_origin(AllowOrigin::list(origins))
                .allow_methods([Method::GET])
                .allow_headers([header::AUTHORIZATION])
                .max_age(Duration::from_secs(600)),
        )
    }
}

fn json(status: StatusCode, body: String) -> Response {
    (status, [(header::CONTENT_TYPE, "application/json")], body).into_response()
}

fn error(status: StatusCode, msg: &str) -> Response {
    json(status, serde_json::json!({ "error": msg }).to_string())
}

fn auth(app: &App, headers: &HeaderMap, q: &HashMap<String, String>) -> Result<Claims, Response> {
    let bearer = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::to_owned);
    let Some(tok) = bearer.or_else(|| q.get("token").cloned()) else {
        return Err(error(StatusCode::UNAUTHORIZED, "missing token"));
    };
    token::verify(&tok, app.cfg.secret.as_bytes(), &app.cfg.aud, token::now())
        .map_err(|m| error(StatusCode::UNAUTHORIZED, m))
}

// Small sync helpers: the std RwLock guard never lives inside an async state machine.
fn current_horizon(app: &App) -> u64 {
    app.feed.read().expect("feed lock").horizon()
}

fn read_feed(app: &App, cursor: u64, max: usize, access: &Access) -> Read {
    app.feed
        .read()
        .expect("feed lock")
        .read(cursor, max, |e| access.allows(e))
}

fn not_ready(app: &App) -> bool {
    !app.ready.load(Ordering::Acquire)
}

async fn events(State(app): State<Arc<App>>, headers: HeaderMap, Query(q): Params) -> Response {
    if not_ready(&app) {
        return error(StatusCode::SERVICE_UNAVAILABLE, "starting");
    }
    let claims = match auth(&app, &headers, &q) {
        Ok(c) => c,
        Err(r) => return r,
    };
    let horizon = current_horizon(&app);

    // No cursor: a new client. It gets "now" and loads its data itself afterwards.
    let cursor = match q
        .get("cursor")
        .map(String::as_str)
        .filter(|s| !s.is_empty())
    {
        None => return json(StatusCode::OK, response_json(horizon, &[], false, false)),
        Some(s) => match s.parse::<u64>() {
            Ok(c) => c,
            Err(_) => return error(StatusCode::BAD_REQUEST, "invalid cursor"),
        },
    };
    let max = q
        .get("limit")
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(1000)
        .clamp(1, 5000);

    match read_feed(&app, cursor, max, &claims.access) {
        Read::Reset => json(StatusCode::OK, response_json(horizon, &[], false, true)),
        Read::Events { events, next, more } => {
            json(StatusCode::OK, response_json(next, &events, more, false))
        }
        Read::BelowFloor { floor } => {
            // Older than the memory buffer: read from notify.event, unless retention already removed it.
            if cursor < app.purged_below.load(Ordering::Acquire) {
                return json(StatusCode::OK, response_json(horizon, &[], false, true));
            }
            let db = app.db.read().await.clone();
            let Some(db) = db else {
                return error(StatusCode::SERVICE_UNAVAILABLE, "database unavailable");
            };
            match db::page(&db, cursor, floor, max).await {
                Ok((rows, next)) => {
                    let events: Vec<Arc<Event>> = rows
                        .into_iter()
                        .filter(|e| claims.access.allows(e))
                        .map(Arc::new)
                        .collect();
                    json(
                        StatusCode::OK,
                        response_json(next, &events, next < horizon, false),
                    )
                }
                Err(e) => {
                    eprintln!("notifyd: catch-up query failed: {e}");
                    error(StatusCode::SERVICE_UNAVAILABLE, "database error")
                }
            }
        }
    }
}

fn hint(cursor: u64) -> SseEvent {
    SseEvent::default()
        .event("hint")
        .data(format!("{{\"cursor\":\"{cursor}\"}}"))
}

async fn stream(State(app): State<Arc<App>>, headers: HeaderMap, Query(q): Params) -> Response {
    if not_ready(&app) {
        return error(StatusCode::SERVICE_UNAVAILABLE, "starting");
    }
    let claims = match auth(&app, &headers, &q) {
        Ok(c) => c,
        Err(r) => return r,
    };

    let (tx, rx) = mpsc::channel::<Result<SseEvent, Infallible>>(16);
    let mut sub = app.tx.subscribe();
    let _ = tx.try_send(Ok(hint(current_horizon(&app))));
    let ttl = Duration::from_secs((claims.exp - token::now()).max(1) as u64);
    let app2 = app.clone();

    tokio::spawn(async move {
        let deadline = tokio::time::sleep(ttl);
        tokio::pin!(deadline);
        loop {
            let next = tokio::select! {
                _ = &mut deadline => {
                    // token expired: client fetches a new one and reconnects
                    let _ = tx.send(Ok(SseEvent::default().event("expired").data("{}"))).await;
                    break;
                }
                _ = tx.closed() => break,
                r = sub.recv() => match r {
                    Ok(batch) => batch.events.iter().any(|e| claims.access.allows(e)).then_some(batch.horizon),
                    Err(broadcast::error::RecvError::Lagged(_)) => Some(current_horizon(&app2)),
                    Err(broadcast::error::RecvError::Closed) => break,
                },
            };
            if let Some(cursor) = next {
                if tx.send(Ok(hint(cursor))).await.is_err() {
                    break;
                }
            }
        }
    });

    Sse::new(ReceiverStream::new(rx))
        .keep_alive(KeepAlive::new().interval(Duration::from_secs(25)))
        .into_response()
}

async fn health(State(app): State<Arc<App>>) -> Response {
    let (horizon, floor, buffered) = {
        let f = app.feed.read().expect("feed lock");
        (f.horizon(), f.floor(), f.len())
    };
    let db_up = app.db.read().await.is_some();
    let body = serde_json::json!({
        "ok": db_up && !not_ready(&app),
        "db": db_up,
        "horizon": horizon.to_string(),
        "floor": floor.to_string(),
        "buffered": buffered,
        "subscribers": app.tx.receiver_count(),
    });
    json(
        if db_up {
            StatusCode::OK
        } else {
            StatusCode::SERVICE_UNAVAILABLE
        },
        body.to_string(),
    )
}
