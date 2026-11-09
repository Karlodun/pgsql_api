//! Optional webhook sinks (CRM, CMS, Nextcloud adapters, ...).
//!
//! Each hook gets its own queue and worker, so a slow receiver delays only itself
//! and receives batches in order. Delivery is best effort (3 attempts); a receiver
//! that must never miss anything should poll `/events` with its own cursor instead.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use serde::Deserialize;
use tokio::sync::mpsc;

use crate::feed::{response_json, Access, Batch, Event};
use crate::token::{access_from, sign_hex, TopicMap};

#[derive(Deserialize)]
struct HookCfg {
    name: String,
    url: String,
    #[serde(default)]
    topics: TopicMap,
    #[serde(default)]
    secret: Option<String>,
}

pub struct Hooks {
    queues: Vec<(String, mpsc::Sender<Arc<Batch>>)>,
}

impl Hooks {
    pub fn none() -> Self {
        Hooks { queues: Vec::new() }
    }

    /// Load `[{"name", "url", "topics": {...}, "secret"?}, ...]` and start one worker per hook.
    pub fn load(path: Option<&str>) -> Result<Self, String> {
        let Some(path) = path else {
            return Ok(Self::none());
        };
        let text = std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
        let cfgs: Vec<HookCfg> = serde_json::from_str(&text).map_err(|e| format!("{path}: {e}"))?;
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|e| e.to_string())?;

        let mut queues = Vec::new();
        let mut seen = HashMap::new();
        for cfg in cfgs {
            if seen.insert(cfg.name.clone(), ()).is_some() {
                return Err(format!("{path}: duplicate webhook name {}", cfg.name));
            }
            let (tx, rx) = mpsc::channel(1000);
            queues.push((cfg.name.clone(), tx));
            let access = access_from(cfg.topics.clone());
            tokio::spawn(worker(cfg, access, http.clone(), rx));
        }
        Ok(Hooks { queues })
    }

    pub fn len(&self) -> usize {
        self.queues.len()
    }

    pub fn dispatch(&self, batch: &Arc<Batch>) {
        for (name, tx) in &self.queues {
            if tx.try_send(batch.clone()).is_err() {
                eprintln!(
                    "notifyd: webhook {name}: queue full, batch up to {} dropped",
                    batch.horizon
                );
            }
        }
    }
}

async fn worker(
    cfg: HookCfg,
    access: Access,
    http: reqwest::Client,
    mut rx: mpsc::Receiver<Arc<Batch>>,
) {
    while let Some(batch) = rx.recv().await {
        let events: Vec<Arc<Event>> = batch
            .events
            .iter()
            .filter(|e| access.allows(e))
            .cloned()
            .collect();
        if events.is_empty() {
            continue;
        }
        let body = response_json(batch.horizon, &events, false, false);
        let signature = cfg
            .secret
            .as_deref()
            .map(|s| format!("sha256={}", sign_hex(s, body.as_bytes())));

        for attempt in 0..3u32 {
            let mut req = http
                .post(&cfg.url)
                .header("content-type", "application/json")
                .body(body.clone());
            if let Some(sig) = &signature {
                req = req.header("x-notifyd-signature", sig.as_str());
            }
            match req.send().await {
                Ok(resp) if resp.status().is_success() => break,
                Ok(resp) => eprintln!("notifyd: webhook {}: HTTP {}", cfg.name, resp.status()),
                Err(e) => eprintln!("notifyd: webhook {}: {e}", cfg.name),
            }
            if attempt < 2 {
                tokio::time::sleep(Duration::from_secs(1 << attempt)).await;
            } else {
                eprintln!(
                    "notifyd: webhook {}: giving up on batch up to {}",
                    cfg.name, batch.horizon
                );
            }
        }
    }
}
