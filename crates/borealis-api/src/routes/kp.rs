use axum::{
    Json,
    extract::{Query, State},
};
use serde::Deserialize;
use sqlx::PgPool;

use crate::error::AppError;
use crate::routes::parse_window;

#[derive(Deserialize)]
pub struct WindowParams {
    window: Option<String>,
}

pub async fn handler(
    State(pool): State<PgPool>,
    Query(params): Query<WindowParams>,
) -> Result<Json<Vec<borealis_db::models::KpReading>>, AppError> {
    let hours = parse_window(params.window)?;
    let rows = borealis_db::db::get_kp(&pool, hours).await?;
    Ok(Json(rows))
}
