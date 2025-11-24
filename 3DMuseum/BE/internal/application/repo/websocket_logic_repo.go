package applicationRepository

import (
	"github.com/gorilla/websocket"
)

type WebsocketRepository interface {
	Subscribe(conn *websocket.Conn, channel string)
	Unsubscribe(conn *websocket.Conn, channel string)
	Register(conn *websocket.Conn)
	UnRegister(conn *websocket.Conn)
	BroadCastProgress(channel string, data map[string]interface{})
}