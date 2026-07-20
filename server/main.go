// Command server implements the Jodoo list-sync service: a small HTTP +
// WebSocket API that lets multiple app installs share and live-sync a todo
// list or a shopping list, identified by a random per-list secret key.
//
// This server is designed to sit behind a TLS-terminating reverse proxy
// (e.g. Caddy or nginx) that forwards both plain requests and the WebSocket
// upgrade to it over plain HTTP on a private port - see server/README.md.
package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"runtime"
	"runtime/debug"
)

// Version is the server's release version, bumped alongside the client.
const Version = "1.1.1"

// printVersion writes version and build information to stdout. Commit
// details come from the VCS metadata Go embeds at build time; they are
// absent when built outside a git checkout or with -buildvcs=false.
func printVersion() {
	fmt.Printf("jodoo-server v%s\n", Version)
	fmt.Printf("  go:      %s (%s/%s)\n", runtime.Version(), runtime.GOOS, runtime.GOARCH)
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return
	}
	var revision, commitTime, modified string
	for _, s := range info.Settings {
		switch s.Key {
		case "vcs.revision":
			revision = s.Value
		case "vcs.time":
			commitTime = s.Value
		case "vcs.modified":
			modified = s.Value
		}
	}
	if revision != "" {
		if len(revision) > 12 {
			revision = revision[:12]
		}
		if modified == "true" {
			revision += " (modified)"
		}
		fmt.Printf("  commit:  %s\n", revision)
	}
	if commitTime != "" {
		fmt.Printf("  from:    %s\n", commitTime)
	}
}

func getenvDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	// Handled before any environment validation so it works standalone.
	for _, arg := range os.Args[1:] {
		if arg == "--version" || arg == "-version" {
			printVersion()
			return
		}
	}

	serverKey := os.Getenv("JODOO_SERVER_KEY")
	if len(serverKey) < minServerKeyLength {
		log.Fatalf("JODOO_SERVER_KEY must be set to a string of at least %d characters", minServerKeyLength)
	}

	dataDir := getenvDefault("DATA_DIR", "./data")
	store, err := NewStore(dataDir)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer store.Close()

	s := &Server{
		store:     store,
		hub:       NewHub(),
		serverKey: serverKey,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/lists", s.requireAuth(s.handleCreateShare))
	mux.HandleFunc("GET /api/lists/{key}", s.requireAuth(s.handleGetShare))
	mux.HandleFunc("GET /ws/{key}", s.requireAuth(s.handleWS))
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok " + Version))
	})

	port := getenvDefault("PORT", "8080")
	addr := ":" + port
	log.Printf("jodoo-server v%s listening on %s (data dir: %s)", Version, addr, dataDir)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}
