package main

import (
	"crypto/subtle"
	"net/http"
	"strings"
)

// minServerKeyLength enforces the "at least 20 characters" requirement for
// the shared server access key (distinct from the per-list share keys).
const minServerKeyLength = 20

// extractServerKey pulls the server access key from a request. HTTP clients
// should use the Authorization header; the query parameter fallback exists
// because React Native's WebSocket client cannot reliably set custom headers
// on the handshake across platforms.
func extractServerKey(r *http.Request) string {
	if h := r.Header.Get("Authorization"); h != "" {
		if rest, ok := strings.CutPrefix(h, "Bearer "); ok {
			return strings.TrimSpace(rest)
		}
	}
	if h := r.Header.Get("X-Server-Key"); h != "" {
		return strings.TrimSpace(h)
	}
	return r.URL.Query().Get("serverKey")
}

// constantTimeEqual compares two secrets without leaking timing information
// about where they first differ.
func constantTimeEqual(a, b string) bool {
	// subtle.ConstantTimeCompare requires equal-length inputs; hash-free
	// approach: pad by comparing against a fixed-size buffer isn't needed
	// here since server keys have a known, fixed configured value - a
	// same-length check is not itself sensitive (key length isn't secret).
	if len(a) != len(b) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// requireAuth wraps a handler so it only runs when the caller presents the
// correct server access key.
func (s *Server) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key := extractServerKey(r)
		if key == "" || !constantTimeEqual(key, s.serverKey) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}
