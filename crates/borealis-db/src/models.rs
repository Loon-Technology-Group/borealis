use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct Kp {
    pub time_tag: String,
    #[serde(rename = "estimated_kp")]
    pub k_index: f32,
}

#[derive(Debug, Deserialize)]
pub struct Bz {
    pub time_tag: String,
    pub bt: f32,
    pub bx_gse: f32,
    pub by_gse: f32,
    pub bz_gse: f32,
    pub theta_gse: f32,
    pub phi_gse: f32,
    pub bx_gsm: f32,
    pub by_gsm: f32,
    pub bz_gsm: f32,
    pub theta_gsm: f32,
    pub phi_gsm: f32,
}

#[derive(Debug)]
pub struct Wind {
    pub time_tag: String,
    pub density: f32,
    pub speed: f32,
    pub temperature: f32,
}

impl Wind {
    pub fn from_row(row: &[String]) -> Option<Wind> {
        if row.len() < 4 {
            return None;
        }
        Some(Wind {
            time_tag: row[0].clone(),
            density: row[1].parse().ok()?,
            speed: row[2].parse().ok()?,
            temperature: row[3].parse().ok()?,
        })
    }
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
    pub bx_gse: f32,
    pub by_gse: f32,
    pub bz_gse: f32,
    pub theta_gse: f32,
    pub phi_gse: f32,
    pub bx_gsm: f32,
    pub by_gsm: f32,
    pub bz_gsm: f32,
    pub theta_gsm: f32,
    pub phi_gsm: f32,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct WindReading {
    pub time_tag: DateTime<Utc>,
    pub density: f32,
    pub speed: f32,
    pub temperature: f32,
}
