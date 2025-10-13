package websocket

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// HandleWS upgrades a Gin request to a websocket and processes subscribe/unsubscribe messages.
// Expected client messages:
//  { "action": "subscribe", "channel": "asset:<CID>" }
//  { "action": "unsubscribe", "channel": "asset:<CID>" }
func HandleWS(c *gin.Context) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		fmt.Println("[WebSocket] upgrade failed:", err)
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	// register connection
	GlobalHub.Register(conn)
	defer GlobalHub.Unregister(conn)

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
				GlobalHub.Subscribe(conn, payload.Channel)
			}
		case "unsubscribe":
			if payload.Channel != "" {
				GlobalHub.Unsubscribe(conn, payload.Channel)
			}
		default:
			// unknown action - ignore or extend later
			fmt.Println("[WebSocket] unknown action:", payload.Action)
		}
	}
}
