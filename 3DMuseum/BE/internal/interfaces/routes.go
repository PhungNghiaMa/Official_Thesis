package api 

import (
	business "main/internal/infrastructure/business"
	multiplayer "main/internal/infrastructure/multiplayer"
	routerEngine "main/internal/interfaces/router"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func RegisterRoutes(router *gin.Engine, database *gorm.DB, PinataService *business.PinataAuth, SFU *multiplayer.SFU) {
	routerEngine.RegisterAssetRoutes(router, database, PinataService, SFU)
}
