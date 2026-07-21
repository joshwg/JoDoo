package main

import (
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	// Native mobile clients don't send a browser Origin header, and this
	// server is already gated by the server access key, so we don't need
	// origin-based CSRF protection here.
	CheckOrigin: func(r *http.Request) bool { return true },
}

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = pongWait / 2
	maxMessageSize = 256 << 10 // 256 KiB — comfortably covers ~100-item lists
)

// handleWS: GET /ws/{key}
// Upgrades to a WebSocket, immediately sends the current snapshot, then
// relays "update" messages from any peer to every other peer in the room in
// real time.
func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	if _, err := s.store.Get(key); err != nil {
		if errors.Is(err, ErrNotFound) {
			writeError(w, http.StatusNotFound, "unknown share key")
			return
		}
		writeError(w, http.StatusInternalServerError, "could not fetch share")
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws upgrade: %v", err)
		return
	}

	c := &wsClient{send: make(chan wsMessage, 16)}
	s.hub.join(key, c)
	defer s.hub.leave(key, c)

	done := make(chan struct{})
	go s.wsWriter(conn, c, done)

	// Send the initial snapshot so the joining client can render immediately.
	// The share is re-read here, AFTER joining the room: an update committed
	// between the validation read above and join would otherwise be missed
	// entirely (its broadcast preceded our membership, and the earlier read
	// predates it). Updates after join reach us via broadcast; if both
	// deliver, clients ignore the older-version frame. trySend keeps this
	// from blocking forever should the writer have already died with a full
	// channel - the queued broadcasts carry state at least as fresh.
	if sh, err := s.store.Get(key); err == nil {
		c.trySend(snapshotMessage(sh))
	} else {
		// A connected client that never received a snapshot would look
		// healthy yet never reconcile (clients arbitrate only on incoming
		// frames); drop the connection so its reconnect loop retries.
		log.Printf("initial snapshot: %v", err)
		close(done)
		return
	}

	s.wsReader(conn, key, c)
	close(done)
}

// wsWriter owns all writes to conn: outgoing messages plus periodic pings.
func (s *Server) wsWriter(conn *websocket.Conn, c *wsClient, done <-chan struct{}) {
	ticker := time.NewTicker(pingPeriod)
	defer ticker.Stop()
	defer conn.Close()

	for {
		select {
		case msg, ok := <-c.send:
			conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := conn.WriteJSON(msg); err != nil {
				return
			}
		case <-ticker.C:
			conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		case <-done:
			return
		}
	}
}

// wsReader owns all reads from conn: incoming "update" messages from this peer.
func (s *Server) wsReader(conn *websocket.Conn, key string, c *wsClient) {
	conn.SetReadLimit(maxMessageSize)
	conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		var msg wsMessage
		if err := conn.ReadJSON(&msg); err != nil {
			return
		}
		if msg.Type != "update" {
			continue
		}
		items := msg.Items
		if items == nil {
			items = []Item{}
		}
		sh, err := s.store.Update(key, msg.Name, items, msg.UpdatedAt)
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				c.trySend(wsMessage{Type: "error", Message: "unknown share key"})
				continue
			}
			log.Printf("update share: %v", err)
			c.trySend(wsMessage{Type: "error", Message: "could not save update"})
			continue
		}
		// Broadcast to every peer (including the sender) so everyone
		// converges on the same version/content.
		s.hub.broadcast(key, snapshotMessage(sh))
	}
}
