-- The compatibility rebuild is implemented in migrateDatabase because SQLite
-- cannot conditionally add a column. This marker documents that the repair is
-- part of the ordered migration history.
SELECT 1;
