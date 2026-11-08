//! Converting API JSON into the SDK's types. Hostile or malformed responses never panic: unknown shapes fall
//! back to neutral defaults, and structurally wrong replies become `invalid_response` errors.

use std::time::SystemTime;

use serde_json::{Map, Value};

use crate::attachment::base64_size;
use crate::error::Error;
use crate::time::ms_to_system_time;
use crate::types::{AttachmentInfo, Email, EmailStatus, FailoverAttempt};

const NULL: Value = Value::Null;

pub(crate) fn get<'a>(v: &'a Value, key: &str) -> &'a Value {
    v.get(key).unwrap_or(&NULL)
}

/// JS `Number(x) || 0` for the shapes the API uses.
pub(crate) fn number(v: &Value) -> f64 {
    let n = match v {
        Value::Number(n) => n.as_f64().unwrap_or(0.0),
        Value::String(s) => s.trim().parse::<f64>().unwrap_or(0.0),
        Value::Bool(true) => 1.0,
        _ => 0.0,
    };
    if n.is_finite() {
        n
    } else {
        0.0
    }
}

pub(crate) fn as_u64(v: &Value) -> u64 {
    let n = number(v);
    if n <= 0.0 {
        0
    } else {
        n as u64
    }
}

pub(crate) fn as_i64(v: &Value) -> i64 {
    let n = number(v);
    n.clamp(-9.0e15, 9.0e15) as i64
}

/// `String(x ?? '')` for scalars; structured values are rendered as compact JSON.
pub(crate) fn js_string(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn opt_string(v: &Value) -> Option<String> {
    v.as_str().map(str::to_owned)
}

fn to_time(v: &Value) -> SystemTime {
    // JavaScript dates span +-8.64e15 ms
    ms_to_system_time(number(v).clamp(-8.64e15, 8.64e15) as i64)
}

fn str_array(v: &Value) -> Option<Vec<String>> {
    v.as_array().map(|a| {
        a.iter()
            .filter_map(|x| x.as_str().map(str::to_owned))
            .collect()
    })
}

fn parse_failover(raw: &Value) -> Vec<FailoverAttempt> {
    let parsed;
    let list = match raw {
        Value::String(s) => match serde_json::from_str::<Value>(s) {
            Ok(v) => {
                parsed = v;
                &parsed
            }
            Err(_) => return Vec::new(),
        },
        other => other,
    };
    let Some(items) = list.as_array() else {
        return Vec::new();
    };
    items
        .iter()
        .map(|f| FailoverAttempt {
            provider: js_string(get(f, "provider")),
            kind: js_string(get(f, "type")),
            error: js_string(get(f, "error")),
            timestamp: to_time(get(f, "timestamp")),
        })
        .collect()
}

fn status_of(v: &Value) -> EmailStatus {
    v.as_str()
        .and_then(|s| s.parse().ok())
        .unwrap_or(EmailStatus::Queued)
}

fn map_attachments(w: &Value, with_content: bool) -> Vec<AttachmentInfo> {
    let Some(items) = w.get("attachments").and_then(Value::as_array) else {
        return Vec::new();
    };
    items
        .iter()
        .map(|a| {
            let content = a.get("content").and_then(Value::as_str);
            let size = if with_content {
                base64_size(content.unwrap_or(""))
            } else {
                match a.get("size") {
                    Some(Value::Number(_)) => as_u64(&a["size"]),
                    _ => content.map(base64_size).unwrap_or(0),
                }
            };
            AttachmentInfo {
                filename: js_string(get(a, "filename")),
                mime_type: opt_string(get(a, "mimeType")),
                size,
                content: with_content.then(|| content.unwrap_or("").to_owned()),
            }
        })
        .collect()
}

/// Map one email row. `with_content` selects the detail shape (attachment `content` included).
pub(crate) fn map_email(w: &Value, with_content: bool) -> Result<Email, Error> {
    if !w.is_object() {
        return Err(Error::protocol("invalid_response", "The server returned an email that is not a JSON object. Is base_url pointing at your Unsent deployment?"));
    }
    let html = match (get(w, "html_body").as_str(), get(w, "body").as_str()) {
        (Some(h), _) => h.to_owned(),
        (None, Some(b)) => b.to_owned(),
        _ => String::new(),
    };
    // The API falls back to the HTML body when no plain-text alternative was stored.
    let text = get(w, "text_body")
        .as_str()
        .filter(|t| !t.is_empty() && *t != html)
        .map(str::to_owned);
    Ok(Email {
        id: as_i64(get(w, "id")),
        status: status_of(get(w, "status")),
        to: str_array(get(w, "to")).unwrap_or_default(),
        cc: str_array(get(w, "cc")),
        bcc: str_array(get(w, "bcc")),
        subject: js_string(get(w, "subject")),
        html_body: html,
        text_body: text,
        from_email: opt_string(get(w, "from_email")),
        from_name: opt_string(get(w, "from_name")),
        provider_id: opt_string(get(w, "provider_id")),
        provider_used: opt_string(get(w, "provider_used")),
        failover_history: parse_failover(get(w, "failover_history")),
        idempotency_key: opt_string(get(w, "idempotency_key")),
        attempts: as_u64(get(w, "attempts")).min(u64::from(u32::MAX)) as u32,
        error: opt_string(get(w, "error")),
        created_at: to_time(get(w, "created_at")),
        updated_at: to_time(get(w, "updated_at")),
        attachments: map_attachments(w, with_content),
    })
}

pub(crate) fn object<'a>(v: &'a Value, what: &str) -> Result<&'a Map<String, Value>, Error> {
    v.as_object()
        .ok_or_else(|| Error::protocol("invalid_response", format!("The server's {what} reply is not a JSON object. Is base_url pointing at your Unsent deployment?")))
}
