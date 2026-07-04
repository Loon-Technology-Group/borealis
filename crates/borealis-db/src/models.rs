use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct Kp {
    pub time_tag: String,
    #[serde(rename = "estimated_kp")]
    pub k_index: f32,
}

#[derive(Debug)]
pub struct Bz {
    pub time_tag: String,
    pub bt: f32,
    pub bx: f32,
    pub by: f32,
    pub bz: f32,
}

impl Bz {
    pub fn from_row(header: &[String], row: &[serde_json::Value]) -> Option<Bz> {
        Some(Bz {
            time_tag: row_field(header, row, "time_tag")?.as_str()?.to_string(),
            bt: row_field(header, row, "bt")?.as_f64()? as f32,
            bx: row_field(header, row, "bx")?.as_f64()? as f32,
            by: row_field(header, row, "by")?.as_f64()? as f32,
            bz: row_field(header, row, "bz")?.as_f64()? as f32,
        })
    }
}

#[derive(Debug)]
pub struct Wind {
    pub time_tag: String,
    pub density: f32,
    pub speed: f32,
    pub temperature: f32,
}

impl Wind {
    pub fn from_row(header: &[String], row: &[serde_json::Value]) -> Option<Wind> {
        Some(Wind {
            time_tag: row_field(header, row, "time_tag")?.as_str()?.to_string(),
            density: row_field(header, row, "density")?.as_f64()? as f32,
            speed: row_field(header, row, "speed")?.as_f64()? as f32,
            temperature: row_field(header, row, "temperature")?.as_f64()? as f32,
        })
    }
}

fn row_field<'a>(
    header: &[String],
    row: &'a [serde_json::Value],
    name: &str,
) -> Option<&'a serde_json::Value> {
    let index = header.iter().position(|h| h == name)?;
    row.get(index)
}

// Reading structs for API responses (deserialized from database rows)

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct KpReading {
    pub time_tag: DateTime<Utc>,
    pub k_index: f32,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct BzReading {
    pub time_tag: DateTime<Utc>,
    pub bt: f32,
    pub bx: f32,
    pub by: f32,
    pub bz: f32,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct WindReading {
    pub time_tag: DateTime<Utc>,
    pub density: f32,
    pub speed: f32,
    pub temperature: f32,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn propagated_solar_wind_header() -> Vec<String> {
        [
            "time_tag",
            "speed",
            "density",
            "temperature",
            "bx",
            "by",
            "bz",
            "bt",
            "vx",
            "vy",
            "vz",
            "propagated_time_tag",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect()
    }

    fn propagated_solar_wind_row() -> Vec<serde_json::Value> {
        vec![
            json!("2026-06-27T14:27:00Z"),
            json!(541.9),
            json!(2.47),
            json!(124989.0),
            json!(2.26),
            json!(-0.17),
            json!(1.94),
            json!(2.99),
            json!(-540.7),
            json!(25.6),
            json!(-24.3),
            json!("2026-06-27T15:04:12Z"),
        ]
    }

    #[test]
    fn wind_from_row_parses_propagated_solar_wind_format() {
        let header = propagated_solar_wind_header();
        let row = propagated_solar_wind_row();

        let wind = Wind::from_row(&header, &row).expect("row should parse");
        assert_eq!(wind.time_tag, "2026-06-27T14:27:00Z");
        assert_eq!(wind.speed, 541.9);
        assert_eq!(wind.density, 2.47);
        assert_eq!(wind.temperature, 124989.0);
    }

    #[test]
    fn wind_from_row_missing_column_returns_none() {
        let header: Vec<String> = ["time_tag", "speed"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let row = vec![json!("2026-06-27T14:27:00Z"), json!(541.9)];
        assert!(Wind::from_row(&header, &row).is_none());
    }

    #[test]
    fn bz_from_row_parses_propagated_solar_wind_format() {
        let header = propagated_solar_wind_header();
        let row = propagated_solar_wind_row();

        let bz = Bz::from_row(&header, &row).expect("row should parse");
        assert_eq!(bz.time_tag, "2026-06-27T14:27:00Z");
        assert_eq!(bz.bt, 2.99);
        assert_eq!(bz.bx, 2.26);
        assert_eq!(bz.by, -0.17);
        assert_eq!(bz.bz, 1.94);
    }

    #[test]
    fn bz_from_row_missing_column_returns_none() {
        let header: Vec<String> = ["time_tag", "bt"].iter().map(|s| s.to_string()).collect();
        let row = vec![json!("2026-06-27T14:27:00Z"), json!(2.99)];
        assert!(Bz::from_row(&header, &row).is_none());
    }
}
