package websocket

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type WebSocketHub struct {
	mu          sync.RWMutex
	connections map[*websocket.Conn]bool
	channels    map[string]map[*websocket.Conn]bool // e.g. "asset:<cid>" or "room:<id>"
}

var GlobalHub = NewHub()

func NewHub() *WebSocketHub {
	return &WebSocketHub{
		connections: make(map[*websocket.Conn]bool),
		channels:    make(map[string]map[*websocket.Conn]bool),
	}
}

// ─── CONNECTION MANAGEMENT ───────────────────────────────

func (h *WebSocketHub) Register(conn *websocket.Conn) {
	h.mu.Lock()
	h.connections[conn] = true
	h.mu.Unlock()
	fmt.Println("[WebSocket] Connected clients:", len(h.connections))
}

func (h *WebSocketHub) Unregister(conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()

	delete(h.connections, conn)
	for channel := range h.channels {
		delete(h.channels[channel], conn)
		if len(h.channels[channel]) == 0 {
			delete(h.channels, channel)
		}
	}
	_ = conn.Close()
	fmt.Println("[WebSocket] Disconnected. Remaining:", len(h.connections))
}

// ─── SUBSCRIPTION MANAGEMENT ─────────────────────────────

func (h *WebSocketHub) Subscribe(conn *websocket.Conn, channel string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.channels[channel] == nil {
		h.channels[channel] = make(map[*websocket.Conn]bool)
	}
	h.channels[channel][conn] = true
	fmt.Printf("[WebSocket] Subscribed to %s\n", channel)
}

func (h *WebSocketHub) Unsubscribe(conn *websocket.Conn, channel string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if subs, ok := h.channels[channel]; ok {
		delete(subs, conn)
		if len(subs) == 0 {
			delete(h.channels, channel)
		}
	}
}

// ─── BROADCASTING ────────────────────────────────────────

// BroadcastProgress sends to all subscribers of a given channel.
// Example channels: "asset:<CID>", "room:<ID>", or "global"
// BroadcastProgress sends a JSON message to all subscribers of a given channel.
// It automatically includes the channel name and a UTC timestamp for debugging or tracking.
func (h *WebSocketHub) BroadcastProgress(channel string, data map[string]interface{}) {
	h.mu.RLock()
	subs := h.channels[channel]
	h.mu.RUnlock()

	if data == nil {
		data = make(map[string]interface{})
	}

	// Inject metadata
	data["channel"] = channel
	data["timestamp"] = time.Now().UTC().Format(time.RFC3339)

	msg, err := json.Marshal(data)
	if err != nil {
		fmt.Println("[WebSocket] Marshal error:", err)
		return
	}

	for conn := range subs {
		if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			fmt.Printf("[WebSocket] Send failed to %s: %v\n", channel, err)
			h.Unregister(conn)
		}
	}
}
