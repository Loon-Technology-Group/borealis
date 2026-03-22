CREATE TABLE bz (
    id BIGSERIAL PRIMARY KEY,
    time_tag TIMESTAMPTZ NOT NULL UNIQUE,
    bt REAL NOT NULL,
    bx_gse REAL NOT NULL,
    by_gse REAL NOT NULL,
    bz_gse REAL NOT NULL,
    theta_gse REAL NOT NULL,
    phi_gse REAL NOT NULL,
    bx_gsm REAL NOT NULL,
    by_gsm REAL NOT NULL,
    bz_gsm REAL NOT NULL,
    theta_gsm REAL NOT NULL,
    phi_gsm REAL NOT NULL
);
