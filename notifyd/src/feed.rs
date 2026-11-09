//! In-memory event feed: ring buffer of released events, ordered by transaction id.
//!
//! Invariant: the buffer holds *every* event with `floor <= xid < horizon`.
//! A client cursor is a horizon value. Asking "what happened since cursor C"
//! means "all events with xid >= C". Because the horizon is the xmin of a
//! database snapshot, no transaction below it can still add events, so the set
//! below the horizon is final and nothing is skipped when commits happen out of
//! order.
//!
//! This module uses only `std` so it can be tested without any dependencies.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;

/// One change event. `json` is the ready-to-send JSON object for clients.
#[derive(Debug)]
pub struct Event {
    pub xid: u64,
    pub topic: String,
    pub scope: Option<String>,
    pub json: String,
}

/// A group of events released together, with the horizon after them.
#[derive(Debug)]
pub struct Batch {
    pub horizon: u64,
    pub events: Vec<Arc<Event>>,
}

/// What a subscriber may see: topic -> None (all scopes) or Some(set of scopes).
#[derive(Debug, Clone, Default)]
pub struct Access {
    pub topics: HashMap<String, Option<HashSet<String>>>,
}

impl Access {
    pub fn allows(&self, e: &Event) -> bool {
        match self.topics.get(&e.topic) {
            None => false,
            Some(None) => true,
            Some(Some(scopes)) => e.scope.as_ref().is_some_and(|s| scopes.contains(s)),
        }
    }
}

/// Result of reading the feed.
#[derive(Debug)]
pub enum Read {
    /// Events visible to the caller, the next cursor, and whether more is pending.
    Events {
        events: Vec<Arc<Event>>,
        next: u64,
        more: bool,
    },
    /// Cursor is older than the buffer: caller must fetch `[cursor, floor)` from the database.
    BelowFloor { floor: u64 },
    /// Cursor is in the future (wrong database or corrupted state): client must resync.
    Reset,
}

pub struct Feed {
    buf: VecDeque<Arc<Event>>,
    horizon: u64,
    floor: u64,
    cap: usize,
}

impl Feed {
    pub fn new(horizon: u64, cap: usize) -> Self {
        Feed {
            buf: VecDeque::new(),
            horizon,
            floor: horizon,
            cap: cap.max(1),
        }
    }

    pub fn horizon(&self) -> u64 {
        self.horizon
    }

    pub fn floor(&self) -> u64 {
        self.floor
    }

    pub fn len(&self) -> usize {
        self.buf.len()
    }

    /// Append events with `self.horizon <= xid < new_horizon` (sorted by xid, id)
    /// and move the horizon forward.
    pub fn push(&mut self, new_horizon: u64, events: Vec<Arc<Event>>) {
        if new_horizon <= self.horizon {
            return;
        }
        debug_assert!(events
            .iter()
            .all(|e| e.xid >= self.horizon && e.xid < new_horizon));
        self.buf.extend(events);
        self.horizon = new_horizon;
        self.trim();
    }

    /// Drop the oldest events beyond capacity. Whole transactions are dropped
    /// together, so the invariant `floor..horizon is complete` keeps holding.
    fn trim(&mut self) {
        if self.buf.len() <= self.cap {
            return;
        }
        let mut last = 0;
        while self.buf.len() > self.cap {
            last = self.buf.pop_front().map(|e| e.xid).unwrap_or(last);
        }
        while self.buf.front().is_some_and(|e| e.xid == last) {
            self.buf.pop_front();
        }
        self.floor = last + 1;
    }

    /// Events with xid >= cursor that pass `filter`, at most `max` of them
    /// (a transaction is never split across two responses).
    pub fn read(&self, cursor: u64, max: usize, filter: impl Fn(&Event) -> bool) -> Read {
        if cursor > self.horizon {
            return Read::Reset;
        }
        if cursor < self.floor {
            return Read::BelowFloor { floor: self.floor };
        }
        let start = self.buf.partition_point(|e| e.xid < cursor);
        let mut events = Vec::new();
        for i in start..self.buf.len() {
            let e = &self.buf[i];
            let group_start = i == start || self.buf[i - 1].xid != e.xid;
            if events.len() >= max.max(1) && group_start {
                return Read::Events {
                    events,
                    next: e.xid,
                    more: true,
                };
            }
            if filter(e) {
                events.push(e.clone());
            }
        }
        Read::Events {
            events,
            next: self.horizon,
            more: false,
        }
    }
}

/// Build the JSON body for a poll response.
pub fn response_json(cursor: u64, events: &[Arc<Event>], more: bool, reset: bool) -> String {
    let mut s = String::with_capacity(64 + events.iter().map(|e| e.json.len() + 1).sum::<usize>());
    s.push_str("{\"cursor\":\"");
    s.push_str(&cursor.to_string());
    s.push_str("\",\"more\":");
    s.push_str(if more { "true" } else { "false" });
    s.push_str(",\"reset\":");
    s.push_str(if reset { "true" } else { "false" });
    s.push_str(",\"events\":[");
    for (i, e) in events.iter().enumerate() {
        if i > 0 {
            s.push(',');
        }
        s.push_str(&e.json);
    }
    s.push_str("]}");
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(xid: u64, topic: &str, scope: Option<&str>) -> Arc<Event> {
        Arc::new(Event {
            xid,
            topic: topic.into(),
            scope: scope.map(Into::into),
            json: format!("{{\"x\":{xid}}}"),
        })
    }

    fn xids(r: &Read) -> (Vec<u64>, u64, bool) {
        match r {
            Read::Events { events, next, more } => {
                (events.iter().map(|e| e.xid).collect(), *next, *more)
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn reads_since_cursor() {
        let mut f = Feed::new(100, 100);
        f.push(
            105,
            vec![ev(100, "a", None), ev(102, "a", None), ev(104, "a", None)],
        );
        assert_eq!(
            xids(&f.read(100, 10, |_| true)),
            (vec![100, 102, 104], 105, false)
        );
        assert_eq!(xids(&f.read(103, 10, |_| true)), (vec![104], 105, false));
        assert_eq!(xids(&f.read(105, 10, |_| true)), (vec![], 105, false));
    }

    #[test]
    fn future_cursor_resets_and_old_cursor_goes_to_db() {
        let f = Feed::new(100, 10);
        assert!(matches!(f.read(101, 10, |_| true), Read::Reset));
        assert!(matches!(
            f.read(99, 10, |_| true),
            Read::BelowFloor { floor: 100 }
        ));
    }

    #[test]
    fn limit_never_splits_a_transaction() {
        let mut f = Feed::new(1, 100);
        f.push(
            4,
            vec![
                ev(1, "a", None),
                ev(2, "a", None),
                ev(2, "a", None),
                ev(3, "a", None),
            ],
        );
        // max 2: takes xid 1 and the full xid-2 group (3 events), stops before xid 3
        assert_eq!(xids(&f.read(1, 2, |_| true)), (vec![1, 2, 2], 3, true));
        assert_eq!(xids(&f.read(3, 2, |_| true)), (vec![3], 4, false));
    }

    #[test]
    fn trim_drops_whole_transactions_and_raises_floor() {
        let mut f = Feed::new(1, 3);
        f.push(
            5,
            vec![
                ev(1, "a", None),
                ev(2, "a", None),
                ev(2, "a", None),
                ev(3, "a", None),
                ev(4, "a", None),
            ],
        );
        // cap 3 → pop xid1, xid2; remaining xid2 must go too → floor 3
        assert_eq!(f.floor(), 3);
        assert_eq!(f.len(), 2);
        assert!(matches!(
            f.read(2, 10, |_| true),
            Read::BelowFloor { floor: 3 }
        ));
        assert_eq!(xids(&f.read(3, 10, |_| true)), (vec![3, 4], 5, false));
    }

    #[test]
    fn access_filter() {
        let mut a = Access::default();
        a.topics.insert("crm.customer".into(), None);
        a.topics.insert(
            "deck.card".into(),
            Some(["7".to_string()].into_iter().collect()),
        );
        assert!(a.allows(&ev(1, "crm.customer", Some("1"))));
        assert!(a.allows(&ev(1, "deck.card", Some("7"))));
        assert!(!a.allows(&ev(1, "deck.card", Some("8"))));
        assert!(!a.allows(&ev(1, "deck.card", None)));
        assert!(!a.allows(&ev(1, "secret", None)));

        let mut f = Feed::new(1, 10);
        f.push(
            4,
            vec![
                ev(1, "deck.card", Some("8")),
                ev(2, "deck.card", Some("7")),
                ev(3, "secret", None),
            ],
        );
        assert_eq!(xids(&f.read(1, 10, |e| a.allows(e))), (vec![2], 4, false));
    }

    #[test]
    fn json_shape() {
        let e = vec![ev(1, "a", None), ev(2, "a", None)];
        assert_eq!(
            response_json(3, &e, false, false),
            r#"{"cursor":"3","more":false,"reset":false,"events":[{"x":1},{"x":2}]}"#
        );
    }
}
