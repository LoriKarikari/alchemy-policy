CREATE TABLE artifacts (
  key TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  version TEXT NOT NULL,
  filename TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size > 0),
  sha256 TEXT NOT NULL,
  content_type TEXT NOT NULL,
  uploaded_at TEXT NOT NULL
);

CREATE INDEX artifacts_by_release
ON artifacts (project, version, filename);
