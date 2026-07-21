package main

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
)

// Server wires together the store, hub, and auth key used by the handlers.
type Server struct {
	store     *Store
	hub       *Hub
	serverKey string
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

type createShareRequest struct {
	Kind  string `json:"kind"`
	Name  string `json:"name"`
	Items []Item `json:"items"`
}

// handleCreateShare: POST /api/lists
// The owner of a list calls this to generate a new random share key, seeding
// the server's copy with the list's current contents.
func (s *Server) handleCreateShare(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxMessageSize)
	var req createShareRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	kind := ListKind(req.Kind)
	if !kind.valid() {
		writeError(w, http.StatusBadRequest, `kind must be "todo" or "shopping"`)
		return
	}
	if req.Items == nil {
		req.Items = []Item{}
	}
	sh, err := s.store.Create(kind, req.Name, req.Items)
	if err != nil {
		log.Printf("create share: %v", err)
		writeError(w, http.StatusInternalServerError, "could not create share")
		return
	}
	writeJSON(w, http.StatusCreated, sh)
}

// handleGetShare: GET /api/lists/{key}
// Used by a joining client to preview/fetch the current snapshot before
// committing to it (e.g. before overwriting their local shopping list).
func (s *Server) handleGetShare(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	sh, err := s.store.Get(key)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			writeError(w, http.StatusNotFound, "unknown share key")
			return
		}
		log.Printf("get share: %v", err)
		writeError(w, http.StatusInternalServerError, "could not fetch share")
		return
	}
	writeJSON(w, http.StatusOK, sh)
}
