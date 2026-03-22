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
    let bz_url = std::env::var("BZ_URL").expect("BZ_URL must be set");
    let wind_url = std::env::var("WIND_URL").expect("WIND_URL must be set");

    let shutdown = shutdown_signal();
    tokio::pin!(shutdown);

    loop {
        fetch_and_store_kp(&client, &pool, &kp_url).await;
        fetch_and_store_bz(&client, &pool, &bz_url).await;
        fetch_and_store_wind(&client, &pool, &wind_url).await;

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

async fn fetch_and_store_bz(client: &reqwest::Client, pool: &PgPool, url: &str) {
    let records = match client.get(url).send().await {
        Ok(resp) => match resp.json::<Vec<Bz>>().await {
            Ok(data) => data,
            Err(e) => {
                error!(error = %e, "Failed to parse bz data");
                return;
            }
        },
        Err(e) => {
            error!(error = %e, "Failed to fetch bz data");
            return;
        }
    };

    if let Err(e) = db::insert_bz(pool, &records).await {
        error!(error = %e, "Failed to insert bz data");
    } else {
        info!(count = records.len(), "Inserted bz records");
    }
}

async fn fetch_and_store_wind(client: &reqwest::Client, pool: &PgPool, url: &str) {
    let raw = match client.get(url).send().await {
        Ok(resp) => match resp.json::<Vec<Vec<String>>>().await {
            Ok(data) => data,
            Err(e) => {
                error!(error = %e, "Failed to parse wind data");
                return;
            }
        },
        Err(e) => {
            error!(error = %e, "Failed to fetch wind data");
            return;
        }
    };

    let records: Vec<Wind> = raw
        .iter()
        .skip(1)
        .filter_map(|row| Wind::from_row(row))
        .collect();

    if let Err(e) = db::insert_wind(pool, &records).await {
        error!(error = %e, "Failed to insert wind data");
    } else {
        info!(count = records.len(), "Inserted wind records");
    }
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("failed to install ctrl+c handler");
    warn!("Received shutdown signal");
}
