package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

// Store persists shares in a SQLite database file inside the configured
// $DATA_DIR directory. SQLite is a good fit here: the server's copy of each
// list is only a temporary aid to synchronization (clients own the real
// data), so a single embedded file - not a full database service - is all
// this needs, while still surviving restarts.
type Store struct {
	db *sql.DB
}

// NewStore opens (creating if necessary) $DATA_DIR/jodoo.db and ensures the
// schema exists.
func NewStore(dataDir string) (*Store, error) {
	if dataDir == "" {
		dataDir = "."
	}
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}
	dbPath := filepath.Join(dataDir, "jodoo.db")

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	// A single connection keeps writes to the SQLite file trivially
	// serialized, which is all the concurrency this workload needs.
	db.SetMaxOpenConns(1)

	if _, err := db.Exec(`PRAGMA journal_mode = WAL`); err != nil {
		db.Close()
		return nil, fmt.Errorf("set journal mode: %w", err)
	}
	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS shares (
			key        TEXT PRIMARY KEY,
			kind       TEXT NOT NULL,
			name       TEXT NOT NULL,
			items_json TEXT NOT NULL,
			version    INTEGER NOT NULL,
			updated_at TEXT NOT NULL
		)
	`); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate schema: %w", err)
	}

	return &Store{db: db}, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanShare(row rowScanner) (*Share, error) {
	var (
		sh        Share
		kind      string
		itemsJSON string
		updatedAt string
	)
	if err := row.Scan(&sh.Key, &kind, &sh.Name, &itemsJSON, &sh.Version, &updatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	sh.Kind = ListKind(kind)
	if err := json.Unmarshal([]byte(itemsJSON), &sh.Items); err != nil {
		return nil, fmt.Errorf("decode items: %w", err)
	}
	t, err := time.Parse(time.RFC3339Nano, updatedAt)
	if err != nil {
		return nil, fmt.Errorf("decode updated_at: %w", err)
	}
	sh.UpdatedAt = t
	return &sh, nil
}

// Get returns the share for key, or ErrNotFound.
func (s *Store) Get(key string) (*Share, error) {
	row := s.db.QueryRow(
		`SELECT key, kind, name, items_json, version, updated_at FROM shares WHERE key = ?`,
		key,
	)
	return scanShare(row)
}

// Create makes a brand new share with a freshly generated, unique key.
func (s *Store) Create(kind ListKind, name string, items []Item) (*Share, error) {
	itemsJSON, err := json.Marshal(items)
	if err != nil {
		return nil, err
	}

	for {
		key, err := generateShareKey()
		if err != nil {
			return nil, err
		}
		res, err := s.db.Exec(
			`INSERT INTO shares (key, kind, name, items_json, version, updated_at)
			 SELECT ?, ?, ?, ?, 1, ?
			 WHERE NOT EXISTS (SELECT 1 FROM shares WHERE key = ?)`,
			key, string(kind), name, string(itemsJSON), time.Now().UTC().Format(time.RFC3339Nano), key,
		)
		if err != nil {
			return nil, err
		}
		if n, err := res.RowsAffected(); err != nil {
			return nil, err
		} else if n == 1 {
			return s.Get(key)
		}
		// Astronomically unlikely 20-char key collision - loop and try again.
	}
}

// Update replaces the name/items of an existing share and bumps its version.
// The whole list is replaced wholesale (last-write-wins) rather than merged,
// since the server only keeps a temporary copy to aid synchronization.
// updatedAt is the editing client's own edit time, relayed so that conflict
// tie-breaks on other devices compare device clocks against device clocks; a
// zero value (older clients) or a future-skewed clock falls back to/clamps
// at server time so one bad clock can't poison the share's timeline.
func (s *Store) Update(key, name string, items []Item, updatedAt time.Time) (*Share, error) {
	itemsJSON, err := json.Marshal(items)
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	if updatedAt.IsZero() || updatedAt.After(now) {
		updatedAt = now
	}

	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	res, err := tx.Exec(
		`UPDATE shares SET name = ?, items_json = ?, version = version + 1, updated_at = ? WHERE key = ?`,
		name, string(itemsJSON), updatedAt.UTC().Format(time.RFC3339Nano), key,
	)
	if err != nil {
		return nil, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, ErrNotFound
	}

	row := tx.QueryRow(
		`SELECT key, kind, name, items_json, version, updated_at FROM shares WHERE key = ?`,
		key,
	)
	sh, err := scanShare(row)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return sh, nil
}
