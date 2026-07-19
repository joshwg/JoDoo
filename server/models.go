package main

import (
	"errors"
	"time"
)

// ListKind identifies which kind of list a share represents. The server does
// not otherwise care about the difference; it only stores and relays data.
type ListKind string

const (
	KindTodo     ListKind = "todo"
	KindShopping ListKind = "shopping"
)

func (k ListKind) valid() bool {
	return k == KindTodo || k == KindShopping
}

// Item is an opaque, client-defined payload for a single list entry (a task
// or a shopping item). The server never interprets its fields - it stores and
// relays it verbatim so it stays compatible with whatever schema the apps use.
type Item map[string]any

// Share is the server's temporary copy of a shared list. It exists only to
// synchronize content between the clients that hold its key - it is not the
// permanent home for the data (each client keeps its own local copy).
type Share struct {
	Key       string    `json:"key"`
	Kind      ListKind  `json:"kind"`
	Name      string    `json:"name"`
	Items     []Item    `json:"items"`
	Version   int64     `json:"version"`
	UpdatedAt time.Time `json:"updatedAt"`
}

var ErrNotFound = errors.New("share not found")
