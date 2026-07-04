use borealis_db::db;
use borealis_db::models::{Bz, Kp, Wind};
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;
use tokio::time::{Duration, sleep};
use tracing::{error, info, warn};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("borealis=info".parse().unwrap()),
        )
        .init();

    dotenvy::dotenv().ok();

    let db_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&db_url)
        .await
        .expect("failed to connect to database");

    info!("Connected to database");

    borealis_db::run_migrations(&pool)
        .await
        .expect("failed to run database migrations");

    info!("Migrations applied");

    let user_agent = std::env::var("USER_AGENT").expect("USER_AGENT must be set");
    let client = reqwest::Client::builder()
        .user_agent(&user_agent)
        .build()
        .expect("failed to build reqwest client");

    let kp_url = std::env::var("KP_URL").expect("KP_URL must be set");
    let wind_url = std::env::var("WIND_URL").expect("WIND_URL must be set");

    let shutdown = shutdown_signal();
    tokio::pin!(shutdown);

    loop {
        fetch_and_store_kp(&client, &pool, &kp_url).await;
        fetch_and_store_wind_and_bz(&client, &pool, &wind_url).await;

        tokio::select! {
            _ = sleep(Duration::from_secs(60)) => {},
            _ = &mut shutdown => break,
        }
    }

    info!("Shutting down");
    pool.close().await;
}

async fn fetch_and_store_kp(client: &reqwest::Client, pool: &PgPool, url: &str) {
    let records = match client.get(url).send().await {
        Ok(resp) => match resp.json::<Vec<Kp>>().await {
            Ok(data) => data,
            Err(e) => {
                error!(error = %e, "Failed to parse kp data");
                return;
            }
        },
        Err(e) => {
            error!(error = %e, "Failed to fetch kp data");
            return;
        }
    };

    if let Err(e) = db::insert_kp(pool, &records).await {
        error!(error = %e, "Failed to insert kp data");
    } else {
        info!(count = records.len(), "Inserted kp records");
    }
}

async fn fetch_and_store_wind_and_bz(client: &reqwest::Client, pool: &PgPool, url: &str) {
    let raw = match client.get(url).send().await {
        Ok(resp) => match resp.json::<Vec<Vec<serde_json::Value>>>().await {
            Ok(data) => data,
            Err(e) => {
                error!(error = %e, "Failed to parse wind/bz data");
                return;
            }
        },
        Err(e) => {
            error!(error = %e, "Failed to fetch wind/bz data");
            return;
        }
    };

    let Some((header, rows)) = raw.split_first() else {
        warn!("wind/bz data response had no rows");
        return;
    };
    let header: Vec<String> = header
        .iter()
        .filter_map(|v| v.as_str().map(str::to_string))
        .collect();

    let wind_records: Vec<Wind> = rows
        .iter()
        .filter_map(|row| Wind::from_row(&header, row))
        .collect();
    if let Err(e) = db::insert_wind(pool, &wind_records).await {
        error!(error = %e, "Failed to insert wind data");
    } else {
        info!(count = wind_records.len(), "Inserted wind records");
    }

    let bz_records: Vec<Bz> = rows
        .iter()
        .filter_map(|row| Bz::from_row(&header, row))
        .collect();
    if let Err(e) = db::insert_bz(pool, &bz_records).await {
        error!(error = %e, "Failed to insert bz data");
    } else {
        info!(count = bz_records.len(), "Inserted bz records");
    }
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("failed to install ctrl+c handler");
    warn!("Received shutdown signal");
}
