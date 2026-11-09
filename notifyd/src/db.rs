//! Database access: one connection that LISTENs and also runs the few queries the daemon needs.

use std::sync::Arc;

use futures_util::{stream, StreamExt};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_postgres::{AsyncMessage, Client, NoTls, Row};

use crate::feed::Event;

pub type Error = Box<dyn std::error::Error + Send + Sync>;

/// NOTIFY channel used by notify.capture(). The payload is empty: the signal only means "look".
pub const CHANNEL: &str = "notify_event";

const SELECT: &str = "select xid::text, topic, scope, \
    json_build_object('id', id, 'ts', ts, 'topic', topic, 'scope', scope, 'table', table_name, \
                      'op', op, 'pk', pk, 'changed', changed_columns)::text \
    from notify.event";

/// Connect, start LISTEN. Every notification becomes a `()` on the returned channel.
pub async fn connect(
    url: &str,
) -> Result<(Arc<Client>, mpsc::UnboundedReceiver<()>, JoinHandle<()>), Error> {
    let (client, mut connection) = tokio_postgres::connect(url, NoTls).await?;
    let (tx, rx) = mpsc::unbounded_channel();

    let task = tokio::spawn(async move {
        let messages = stream::poll_fn(move |cx| connection.poll_message(cx));
        tokio::pin!(messages);
        while let Some(msg) = messages.next().await {
            match msg {
                Ok(AsyncMessage::Notification(_)) => {
                    if tx.send(()).is_err() {
                        break;
                    }
                }
                Ok(AsyncMessage::Notice(n)) => {
                    eprintln!("notifyd: postgres notice: {}", n.message())
                }
                Ok(_) => {}
                Err(e) => {
                    eprintln!("notifyd: database connection error: {e}");
                    break;
                }
            }
        }
        // dropping `tx` tells the feed loop that the connection is gone
    });

    client.batch_execute(&format!("LISTEN {CHANNEL}")).await?;
    Ok((Arc::new(client), rx, task))
}

fn row_to_event(row: &Row) -> Result<Event, Error> {
    let xid: String = row.try_get(0)?;
    Ok(Event {
        xid: xid.parse()?,
        topic: row.try_get(1)?,
        scope: row.try_get(2)?,
        json: row.try_get(3)?,
    })
}

async fn query_u64(db: &Client, sql: &str) -> Result<u64, Error> {
    let s: String = db.query_one(sql, &[]).await?.try_get(0)?;
    Ok(s.parse()?)
}

/// Safe horizon: every transaction below it has finished.
pub async fn horizon(db: &Client) -> Result<u64, Error> {
    query_u64(db, "select notify.horizon()::text").await
}

/// Everything below this horizon was removed by retention.
pub async fn purged_below(db: &Client) -> Result<u64, Error> {
    query_u64(db, "select purged_below::text from notify.meta").await
}

/// Run retention. Returns (deleted rows, new purged_below).
pub async fn purge(db: &Client, keep_secs: u64) -> Result<(u64, u64), Error> {
    let keep = format!("{keep_secs} seconds");
    let n: String = db
        .query_one("select notify.purge($1::text::interval)::text", &[&keep])
        .await?
        .try_get(0)?;
    Ok((n.parse()?, purged_below(db).await?))
}

/// Events with `from <= xid < to`, at most about `limit` of them, never splitting a transaction.
/// Returns the events and the cursor to continue from (== `to` when the range is exhausted).
pub async fn page(
    db: &Client,
    from: u64,
    to: u64,
    limit: usize,
) -> Result<(Vec<Event>, u64), Error> {
    if from >= to {
        return Ok((Vec::new(), to));
    }
    let limit = limit.max(1);
    let sql = format!(
        "{SELECT} where xid >= $1::text::xid8 and xid < $2::text::xid8 order by xid, id limit $3"
    );
    let rows = db
        .query(
            sql.as_str(),
            &[&from.to_string(), &to.to_string(), &((limit + 1) as i64)],
        )
        .await?;
    let mut events = rows
        .iter()
        .map(row_to_event)
        .collect::<Result<Vec<_>, _>>()?;

    if events.len() <= limit {
        return Ok((events, to));
    }

    // More than `limit`: stop before the transaction the extra row belongs to.
    let cut = events[limit].xid;
    events.retain(|e| e.xid < cut);
    if !events.is_empty() {
        return Ok((events, cut));
    }

    // One single transaction is larger than `limit`: return it whole.
    let sql = format!("{SELECT} where xid = $1::text::xid8 order by id");
    let rows = db.query(sql.as_str(), &[&cut.to_string()]).await?;
    let events = rows
        .iter()
        .map(row_to_event)
        .collect::<Result<Vec<_>, _>>()?;
    Ok((events, cut + 1))
}
