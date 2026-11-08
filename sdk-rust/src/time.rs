//! Calendar and HTTP-date helpers (no external date library).

use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's algorithm).
pub(crate) fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The inverse of [`days_from_civil`]: `(year, month, day)`.
pub(crate) fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Milliseconds since the Unix epoch (negative before 1970).
pub(crate) fn system_time_ms(t: SystemTime) -> i64 {
    match t.duration_since(UNIX_EPOCH) {
        Ok(d) => i64::try_from(d.as_millis()).unwrap_or(i64::MAX),
        Err(e) => i64::try_from(e.duration().as_millis())
            .map(|v| -v)
            .unwrap_or(i64::MIN),
    }
}

pub(crate) fn now_ms() -> i64 {
    system_time_ms(SystemTime::now())
}

/// Epoch milliseconds to `SystemTime`, never panicking on out-of-range values.
pub(crate) fn ms_to_system_time(ms: i64) -> SystemTime {
    let d = Duration::from_millis(ms.unsigned_abs());
    let t = if ms >= 0 {
        UNIX_EPOCH.checked_add(d)
    } else {
        UNIX_EPOCH.checked_sub(d)
    };
    t.unwrap_or(UNIX_EPOCH)
}

const MONTHS: [&str; 12] = [
    "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
];

fn month_number(token: &str) -> Option<i64> {
    let lower = token.to_ascii_lowercase();
    MONTHS
        .iter()
        .position(|m| lower.starts_with(m) && lower.len() >= 3)
        .map(|i| i as i64 + 1)
}

fn num(token: &str) -> Option<i64> {
    if token.is_empty() || token.len() > 4 || !token.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    token.parse().ok()
}

/// Parse an HTTP date (IMF-fixdate, RFC 850 or asctime) into epoch milliseconds.
pub(crate) fn parse_http_date(input: &str) -> Option<i64> {
    if input.len() > 64 {
        return None;
    }
    let normalized: String = input
        .chars()
        .map(|c| if matches!(c, ',' | '-' | ':') { ' ' } else { c })
        .collect();
    let tokens: Vec<&str> = normalized.split_whitespace().collect();
    // tokens start with a weekday name in every format
    let (day, month, year, h, mi, s) = match tokens.as_slice() {
        // "Sun, 06 Nov 1994 08:49:37 GMT" and "Sunday, 06-Nov-94 08:49:37 GMT"
        [_wd, d, mon, y, h, mi, s, tz]
            if tz.eq_ignore_ascii_case("gmt") || tz.eq_ignore_ascii_case("utc") =>
        {
            let mut year = num(y)?;
            if y.len() == 2 {
                year += if year >= 70 { 1900 } else { 2000 };
            } else if y.len() != 4 {
                return None;
            }
            (
                num(d)?,
                month_number(mon)?,
                year,
                num(h)?,
                num(mi)?,
                num(s)?,
            )
        }
        // "Sun Nov  6 08:49:37 1994"
        [_wd, mon, d, h, mi, s, y] if y.len() == 4 => (
            num(d)?,
            month_number(mon)?,
            num(y)?,
            num(h)?,
            num(mi)?,
            num(s)?,
        ),
        _ => return None,
    };
    if !(1..=31).contains(&day) || h > 23 || mi > 59 || s > 60 {
        return None;
    }
    let days = days_from_civil(year, month, day);
    // reject impossible dates such as 31 Feb
    if civil_from_days(days) != (year, month, day) {
        return None;
    }
    Some((days * 86_400 + h * 3600 + mi * 60 + s) * 1000)
}

/// `YYYY-MM-DD` (UTC) for an epoch-millisecond instant, or `None` outside years 0000-9999.
pub(crate) fn utc_day_string(ms: i64) -> Option<String> {
    let (y, m, d) = civil_from_days(ms.div_euclid(86_400_000));
    (0..=9999)
        .contains(&y)
        .then(|| format!("{y:04}-{m:02}-{d:02}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_roundtrip() {
        for z in (-800_000i64..800_000).step_by(37) {
            let (y, m, d) = civil_from_days(z);
            assert_eq!(days_from_civil(y, m, d), z);
        }
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2000, 3, 1), 11_017);
    }

    #[test]
    fn http_dates() {
        let expect = 784_111_777_000;
        assert_eq!(
            parse_http_date("Sun, 06 Nov 1994 08:49:37 GMT"),
            Some(expect)
        );
        assert_eq!(
            parse_http_date("Sunday, 06-Nov-94 08:49:37 GMT"),
            Some(expect)
        );
        assert_eq!(parse_http_date("Sun Nov  6 08:49:37 1994"), Some(expect));
        assert_eq!(parse_http_date("Sun, 31 Feb 1994 08:49:37 GMT"), None);
        assert_eq!(parse_http_date("garbage"), None);
        assert_eq!(parse_http_date(""), None);
        assert_eq!(parse_http_date("Sun, 06 Nov 1994 25:49:37 GMT"), None);
    }

    #[test]
    fn day_strings() {
        assert_eq!(
            utc_day_string(1_767_654_000_000).as_deref(),
            Some("2026-01-05")
        );
        assert_eq!(utc_day_string(-1), Some("1969-12-31".into()));
        assert_eq!(utc_day_string(i64::MAX), None);
    }
}
