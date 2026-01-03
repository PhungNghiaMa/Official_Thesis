package api 

import (
	business "main/internal/infrastructure/business"
	multiplayer "main/internal/infrastructure/multiplayer"
	routerEngine "main/internal/interfaces/router"
	genai "main/internal/infrastructure/gen_ai"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func RegisterRoutes(router *gin.Engine, database *gorm.DB, PinataService *business.PinataAuth, SFU *multiplayer.SFU, genAIConfig *genai.GeminiClientConfig) {
	routerEngine.RegisterAssetRoutes(router, database, PinataService, SFU)
	routerEngine.RegisterGenAIRoutes(router, genAIConfig)
}
