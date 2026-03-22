use chrono::NaiveDateTime;
use sqlx::PgPool;

use crate::models::{Bz, BzReading, Kp, KpReading, Wind, WindReading};

fn parse_timestamp(s: &str) -> Option<NaiveDateTime> {
    NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S")
        .or_else(|_| NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S%.f"))
        .ok()
}

pub async fn insert_kp(pool: &PgPool, records: &[Kp]) -> Result<(), sqlx::Error> {
    for record in records {
        let Some(time_tag) = parse_timestamp(&record.time_tag) else {
            continue;
        };
        sqlx::query(
            "INSERT INTO kp (time_tag, k_index)
             VALUES ($1, $2)
             ON CONFLICT (time_tag) DO NOTHING",
        )
        .bind(time_tag)
        .bind(record.k_index)
        .execute(pool)
        .await?;
    }
    Ok(())
}

pub async fn insert_bz(pool: &PgPool, records: &[Bz]) -> Result<(), sqlx::Error> {
    for record in records {
        let Some(time_tag) = parse_timestamp(&record.time_tag) else {
            continue;
        };
        sqlx::query(
            "INSERT INTO bz (time_tag, bt, bx_gse, by_gse, bz_gse, theta_gse, phi_gse, bx_gsm, by_gsm, bz_gsm, theta_gsm, phi_gsm)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             ON CONFLICT (time_tag) DO NOTHING",
        )
        .bind(time_tag)
        .bind(record.bt)
        .bind(record.bx_gse)
        .bind(record.by_gse)
        .bind(record.bz_gse)
        .bind(record.theta_gse)
        .bind(record.phi_gse)
        .bind(record.bx_gsm)
        .bind(record.by_gsm)
        .bind(record.bz_gsm)
        .bind(record.theta_gsm)
        .bind(record.phi_gsm)
        .execute(pool)
        .await?;
    }
    Ok(())
}

pub async fn insert_wind(pool: &PgPool, records: &[Wind]) -> Result<(), sqlx::Error> {
    for record in records {
        let Some(time_tag) = parse_timestamp(&record.time_tag) else {
            continue;
        };
        sqlx::query(
            "INSERT INTO wind (time_tag, density, speed, temperature)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (time_tag) DO NOTHING",
        )
        .bind(time_tag)
        .bind(record.density)
        .bind(record.speed)
        .bind(record.temperature)
        .execute(pool)
        .await?;
    }
    Ok(())
}

// Windowed queries

pub async fn get_kp(pool: &PgPool, hours: i64) -> Result<Vec<KpReading>, sqlx::Error> {
    sqlx::query_as::<_, KpReading>(
        "SELECT time_tag, k_index FROM kp
         WHERE time_tag >= NOW() - ($1 * INTERVAL '1 hour')
         ORDER BY time_tag ASC",
    )
    .bind(hours)
    .fetch_all(pool)
    .await
}

pub async fn get_bz(pool: &PgPool, hours: i64) -> Result<Vec<BzReading>, sqlx::Error> {
    sqlx::query_as::<_, BzReading>(
        "SELECT time_tag, bt, bx_gse, by_gse, bz_gse, theta_gse, phi_gse,
                bx_gsm, by_gsm, bz_gsm, theta_gsm, phi_gsm
         FROM bz
         WHERE time_tag >= NOW() - ($1 * INTERVAL '1 hour')
         ORDER BY time_tag ASC",
    )
    .bind(hours)
    .fetch_all(pool)
    .await
}

pub async fn get_wind(pool: &PgPool, hours: i64) -> Result<Vec<WindReading>, sqlx::Error> {
    sqlx::query_as::<_, WindReading>(
        "SELECT time_tag, density, speed, temperature FROM wind
         WHERE time_tag >= NOW() - ($1 * INTERVAL '1 hour')
         ORDER BY time_tag ASC",
    )
    .bind(hours)
    .fetch_all(pool)
    .await
}

// Latest single row queries

pub async fn get_latest_kp(pool: &PgPool) -> Result<Option<KpReading>, sqlx::Error> {
    sqlx::query_as::<_, KpReading>(
        "SELECT time_tag, k_index FROM kp ORDER BY time_tag DESC LIMIT 1",
    )
    .fetch_optional(pool)
    .await
}

pub async fn get_latest_bz(pool: &PgPool) -> Result<Option<BzReading>, sqlx::Error> {
    sqlx::query_as::<_, BzReading>(
        "SELECT time_tag, bt, bx_gse, by_gse, bz_gse, theta_gse, phi_gse,
                bx_gsm, by_gsm, bz_gsm, theta_gsm, phi_gsm
         FROM bz ORDER BY time_tag DESC LIMIT 1",
    )
    .fetch_optional(pool)
    .await
}

pub async fn get_latest_wind(pool: &PgPool) -> Result<Option<WindReading>, sqlx::Error> {
    sqlx::query_as::<_, WindReading>(
        "SELECT time_tag, density, speed, temperature FROM wind
         ORDER BY time_tag DESC LIMIT 1",
    )
    .fetch_optional(pool)
    .await
}
