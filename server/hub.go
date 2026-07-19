package main

import (
	"sync"
)

// wsMessage is the JSON envelope exchanged over a share's WebSocket
// connection, in both directions.
type wsMessage struct {
	Type    string `json:"type"`              // "snapshot" | "update" | "error"
	Version int64  `json:"version,omitempty"` // snapshot: server version; update: ignored
	Name    string `json:"name,omitempty"`
	Items   []Item `json:"items,omitempty"`
	Message string `json:"message,omitempty"` // error only
}

type wsClient struct {
	send chan wsMessage
}

type room struct {
	mu      sync.Mutex
	clients map[*wsClient]struct{}
}

// Hub fans out share updates to every connected client for that share's key.
type Hub struct {
	mu    sync.Mutex
	rooms map[string]*room
}

func NewHub() *Hub {
	return &Hub{rooms: make(map[string]*room)}
}

func (h *Hub) join(key string, c *wsClient) {
	h.mu.Lock()
	r, ok := h.rooms[key]
	if !ok {
		r = &room{clients: make(map[*wsClient]struct{})}
		h.rooms[key] = r
	}
	h.mu.Unlock()

	r.mu.Lock()
	r.clients[c] = struct{}{}
	r.mu.Unlock()
}

func (h *Hub) leave(key string, c *wsClient) {
	h.mu.Lock()
	r, ok := h.rooms[key]
	h.mu.Unlock()
	if !ok {
		return
	}
	r.mu.Lock()
	delete(r.clients, c)
	empty := len(r.clients) == 0
	r.mu.Unlock()

	if empty {
		h.mu.Lock()
		// Re-check under the hub lock in case another connection joined
		// between our unlock above and this point.
		if r2, ok := h.rooms[key]; ok {
			r2.mu.Lock()
			stillEmpty := len(r2.clients) == 0
			r2.mu.Unlock()
			if stillEmpty {
				delete(h.rooms, key)
			}
		}
		h.mu.Unlock()
	}
}

// broadcast sends msg to every client currently connected for key, including
// the sender (the sender treats it as confirmation of its own update).
func (h *Hub) broadcast(key string, msg wsMessage) {
	h.mu.Lock()
	r, ok := h.rooms[key]
	h.mu.Unlock()
	if !ok {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for c := range r.clients {
		select {
		case c.send <- msg:
		default:
			// Slow consumer: drop the message rather than block every other
			// peer in the room. The client's next update will resync it.
		}
	}
}
