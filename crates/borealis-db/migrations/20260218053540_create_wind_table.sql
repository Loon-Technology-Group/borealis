CREATE TABLE wind (
    id BIGSERIAL PRIMARY KEY,
    time_tag TIMESTAMPTZ NOT NULL UNIQUE,
    density REAL NOT NULL,
    speed REAL NOT NULL,
    temperature REAL NOT NULL
);
