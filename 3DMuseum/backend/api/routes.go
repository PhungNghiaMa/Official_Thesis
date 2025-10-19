package api

import (
	"main/business"
	"main/websocket"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func RegisterRoutes(router *gin.Engine, database *gorm.DB, PinataService *business.PinataService, SFU *websocket.SFU) {
	RegisterAssetRoutes(router, database, PinataService, SFU)
}
