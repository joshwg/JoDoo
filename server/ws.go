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
	maxMessageSize = 1 << 20 // 1 MiB of list content is plenty
)

// handleWS: GET /ws/{key}
// Upgrades to a WebSocket, immediately sends the current snapshot, then
// relays "update" messages from any peer to every other peer in the room in
// real time.
func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	sh, err := s.store.Get(key)
	if err != nil {
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
	c.send <- wsMessage{Type: "snapshot", Version: sh.Version, Name: sh.Name, Items: sh.Items}

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
		sh, err := s.store.Update(key, msg.Name, items)
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				c.send <- wsMessage{Type: "error", Message: "unknown share key"}
				continue
			}
			log.Printf("update share: %v", err)
			c.send <- wsMessage{Type: "error", Message: "could not save update"}
			continue
		}
		// Broadcast to every peer (including the sender) so everyone
		// converges on the same version/content.
		s.hub.broadcast(key, wsMessage{Type: "snapshot", Version: sh.Version, Name: sh.Name, Items: sh.Items})
	}
}
