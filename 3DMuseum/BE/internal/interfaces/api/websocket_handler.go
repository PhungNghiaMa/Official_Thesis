package api

import (
	"encoding/json"
	"fmt"
	"net/http"

	applicationRepository "main/internal/application/repo"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}


type WebsocketHandler struct {
	Hub applicationRepository.WebsocketRepository
}

func NewWebsocketHandler (hub applicationRepository.WebsocketRepository) *WebsocketHandler {
	return &WebsocketHandler{
		Hub: hub,
	}
}

// HandleWS upgrades a Gin request to a websocket and processes subscribe/unsubscribe messages.
// Expected client messages:
//  { "action": "subscribe", "channel": "asset:<CID>" }
//  { "action": "unsubscribe", "channel": "asset:<CID>" }
func (h *WebsocketHandler) HandleWS(c *gin.Context) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		fmt.Println("[WebSocket] upgrade failed:", err)
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	// register connection
	h.Hub.Register(conn)
	defer h.Hub.UnRegister(conn)

	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			// client disconnected or read error
			fmt.Println("[WebSocket] read error:", err)
			return
		}
		var payload struct {
			Action  string `json:"action"`
			Channel string `json:"channel"`
		}
		if err := json.Unmarshal(msg, &payload); err != nil {
			// ignore malformed messages
			continue
		}
		switch payload.Action {
		case "subscribe":
			if payload.Channel != "" {
				h.Hub.Subscribe(conn, payload.Channel)
			}
		case "unsubscribe":
			if payload.Channel != "" {
				h.Hub.Unsubscribe(conn, payload.Channel)
			}
		default:
			// unknown action - ignore or extend later
			fmt.Println("[WebSocket] unknown action:", payload.Action)
		}
	}
}
