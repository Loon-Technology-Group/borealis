use axum::{Json, extract::State};
use serde::Serialize;
use sqlx::PgPool;

use crate::error::AppError;

#[derive(Serialize)]
pub struct LatestResponse {
    kp: Option<borealis_db::models::KpReading>,
    bz: Option<borealis_db::models::BzReading>,
    wind: Option<borealis_db::models::WindReading>,
}

pub async fn handler(State(pool): State<PgPool>) -> Result<Json<LatestResponse>, AppError> {
    let (kp, bz, wind) = tokio::try_join!(
        borealis_db::db::get_latest_kp(&pool),
        borealis_db::db::get_latest_bz(&pool),
        borealis_db::db::get_latest_wind(&pool),
    )?;
    Ok(Json(LatestResponse { kp, bz, wind }))
}
