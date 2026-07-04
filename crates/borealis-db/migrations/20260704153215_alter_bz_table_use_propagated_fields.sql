ALTER TABLE bz
    DROP COLUMN bx_gse,
    DROP COLUMN by_gse,
    DROP COLUMN bz_gse,
    DROP COLUMN theta_gse,
    DROP COLUMN phi_gse,
    DROP COLUMN theta_gsm,
    DROP COLUMN phi_gsm;

ALTER TABLE bz
    RENAME COLUMN bx_gsm TO bx;

ALTER TABLE bz
    RENAME COLUMN by_gsm TO by;

ALTER TABLE bz
    RENAME COLUMN bz_gsm TO bz;
