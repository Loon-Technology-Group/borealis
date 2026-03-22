use axum::{Router, routing::get};
use axum_server::tls_rustls::RustlsConfig;
use tower_http::{cors::CorsLayer, services::ServeDir};

mod error;
mod routes;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();
    dotenvy::dotenv().ok();

    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");

    let skip_tls = std::env::var("SKIP_TLS")
        .unwrap_or_default()
        .to_lowercase()
        == "true";

    let pool = sqlx::PgPool::connect(&database_url).await?;
    borealis_db::run_migrations(&pool).await?;

    // ServeDir resolves relative to the working directory at runtime.
    // Run `cargo run -p borealis-api` from the workspace root so `frontend/` resolves correctly.
    let app = Router::new()
        .route("/api/kp", get(routes::kp::handler))
        .route("/api/bz", get(routes::bz::handler))
        .route("/api/wind", get(routes::wind::handler))
        .route("/api/latest", get(routes::latest::handler))
        .fallback_service(ServeDir::new("frontend"))
        .layer(CorsLayer::permissive())
        .with_state(pool);

    if skip_tls {
        let addr = "0.0.0.0:3000".parse().unwrap();
        tracing::info!("TLS disabled — listening on http://{}", addr);
        axum_server::bind(addr)
            .serve(app.into_make_service())
            .await
            .unwrap();
    } else {
        let cert_path = std::env::var("TLS_CERT_PATH")
            .expect("TLS_CERT_PATH must be set when SKIP_TLS is not true");
        let key_path = std::env::var("TLS_KEY_PATH")
            .expect("TLS_KEY_PATH must be set when SKIP_TLS is not true");

        let config = RustlsConfig::from_pem_file(&cert_path, &key_path)
            .await
            .expect("failed to load TLS certificate — check TLS_CERT_PATH and TLS_KEY_PATH");

        let addr = "0.0.0.0:443".parse().unwrap();
        tracing::info!("TLS enabled — listening on https://{}", addr);
        axum_server::bind_rustls(addr, config)
            .serve(app.into_make_service())
            .await
            .unwrap();
    }

    Ok(())
}
