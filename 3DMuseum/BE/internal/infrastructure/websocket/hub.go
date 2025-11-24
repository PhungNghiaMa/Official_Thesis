package websocket

import (
	"sync"

	"github.com/gorilla/websocket"
)

type WebSocketHub struct {
	mu          sync.RWMutex
	connections map[*websocket.Conn]bool
	channels    map[string]map[*websocket.Conn]bool // e.g. "asset:<cid>" or "room:<id>"
}

func NewWebSocketHub() *WebSocketHub {
	return &WebSocketHub{
		connections: make(map[*websocket.Conn]bool),
		channels:    make(map[string]map[*websocket.Conn]bool),
	}
}