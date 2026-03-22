pub mod bz;
pub mod kp;
pub mod latest;
pub mod wind;

use crate::error::AppError;

pub fn parse_window(window: Option<String>) -> Result<i64, AppError> {
    let hours = match window.as_deref().unwrap_or("24h") {
        "1h" => 1,
        "3h" => 3,
        "6h" => 6,
        "12h" => 12,
        "24h" => 24,
        "7d" => 168,
        other => {
            return Err(AppError::BadRequest(format!(
                "invalid window '{}', must be one of: 1h, 3h, 6h, 12h, 24h, 7d",
                other
            )));
        }
    };
    Ok(hours)
}
