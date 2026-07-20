package main

import (
	"sync"
	"time"
)

// wsMessage is the JSON envelope exchanged over a share's WebSocket
// connection, in both directions.
type wsMessage struct {
	Type    string `json:"type"`              // "snapshot" | "update" | "error"
	Version int64  `json:"version,omitempty"` // snapshot: server version; update: ignored
	Name    string `json:"name,omitempty"`
	Items   []Item `json:"items,omitempty"`
	// Snapshot: when the share's content was last edited; update: the
	// sender's own edit time, relayed verbatim so clients' conflict
	// tie-breaks compare device clocks against device clocks.
	UpdatedAt time.Time `json:"updatedAt,omitzero"`
	Message   string    `json:"message,omitempty"` // error only
}

// snapshotMessage builds the snapshot frame for a share; the single place
// the snapshot wire shape is assembled (initial send and broadcast alike).
func snapshotMessage(sh *Share) wsMessage {
	return wsMessage{Type: "snapshot", Version: sh.Version, Name: sh.Name, Items: sh.Items, UpdatedAt: sh.UpdatedAt}
}

type wsClient struct {
	send chan wsMessage
}

// trySend queues msg without blocking; the message is dropped if the client's
// writer has fallen behind or died. Callers rely on this never blocking.
func (c *wsClient) trySend(msg wsMessage) {
	select {
	case c.send <- msg:
	default:
	}
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

// join and leave both hold the hub lock for the whole membership change, so
// leave can never delete a room out of the map while join is adding a client
// to it (which would leave that client in an orphaned room that no broadcast
// can reach).
func (h *Hub) join(key string, c *wsClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	r, ok := h.rooms[key]
	if !ok {
		r = &room{clients: make(map[*wsClient]struct{})}
		h.rooms[key] = r
	}
	r.mu.Lock()
	r.clients[c] = struct{}{}
	r.mu.Unlock()
}

func (h *Hub) leave(key string, c *wsClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	r, ok := h.rooms[key]
	if !ok {
		return
	}
	r.mu.Lock()
	delete(r.clients, c)
	empty := len(r.clients) == 0
	r.mu.Unlock()
	if empty {
		delete(h.rooms, key)
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
		// Slow consumer: drop the message rather than block every other
		// peer in the room. The client's next update will resync it.
		c.trySend(msg)
	}
}
