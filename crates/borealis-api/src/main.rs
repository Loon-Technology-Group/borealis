use axum::{Router, routing::get};
use tower_http::{cors::CorsLayer, services::ServeDir};

mod error;
mod routes;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();
    dotenvy::dotenv().ok();

    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");

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

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await?;
    tracing::info!("listening on {}", listener.local_addr()?);
    axum::serve(listener, app).await?;

    Ok(())
}
